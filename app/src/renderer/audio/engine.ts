import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
// Vite resolves the ?url suffix. eslint-plugin-import does not.
// eslint-disable-next-line import/no-unresolved
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

declare module "@soundtouchjs/audio-worklet/processor?url" {
  const url: string;
  export default url;
}

export type TransportParams = {
  speed: number;
  pitchSemitones: number;
  pan: number;
  fadeInSec: number;
  fadeOutSec: number;
};

export type RegionSec = { start: number; end: number };

export type EditorPhase = "idle" | "playing" | "paused";

export type BedState = { owner: "editor" | "list"; itemId: string | null };

export type EditorPlayOptions = {
  buffer: AudioBuffer;
  region: RegionSec;
  params: TransportParams;
  loop: boolean;
  itemId: string | null;
  /** Present only when resuming a pause. Otherwise start at region.start. */
  resumeOffset?: number;
};

export type ListPlayOptions = {
  itemId: string;
  buffer: AudioBuffer;
  region: RegionSec;
  params: TransportParams;
};

type BedOwner = "editor" | "list";

type ClockAnchor = {
  contextTime: number;
  offset: number;
  speed: number;
};

type Voice = {
  itemId: string | null;
  loop: boolean;
  bedOwner: BedOwner | null;
  buffer: AudioBuffer;
  region: RegionSec;
  params: TransportParams;
  /** Fade-out scheduled for this run. Slider edits update `params` only. */
  scheduledFadeOut: number;
  source: AudioBufferSourceNode;
  stNode: SoundTouchNode | null;
  gain: GainNode;
  panner: StereoPannerNode;
  anchor: ClockAnchor;
  fadeInEndsAt: number;
  active: boolean;
  fading: boolean;
  released: boolean;
  usesWorklet: boolean;
  token: number;
};

let audioContext: AudioContext | null = null;
const worklets = new WeakMap<AudioContext, Promise<void>>();

let bed: Voice | null = null;
let fadingBed: Voice | null = null;
let editorVoice: Voice | null = null;
let editorPhase: EditorPhase = "idle";
let editorOffset = 0;
let editorRegion: RegionSec = { start: 0, end: 0 };
let oneshots: Voice[] = [];
let startSerial = 0;
let graphSerial = 0;

export function ensureAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = ensureAudioContext();
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return ctx.decodeAudioData(copy);
}

export function clampFades(
  regionLength: number,
  fadeInSec: number,
  fadeOutSec: number,
  loop: boolean,
): { fadeInSec: number; fadeOutSec: number } {
  const limit = regionLength > 0 ? regionLength : 0;
  let fadeIn = fadeInSec < 0 ? 0 : fadeInSec;
  let fadeOut = fadeOutSec < 0 ? 0 : fadeOutSec;
  if (fadeIn > limit) fadeIn = limit;
  if (fadeOut > limit) fadeOut = limit;
  if (!loop && fadeIn + fadeOut > limit) {
    const sum = fadeIn + fadeOut;
    if (sum > 0) {
      const scale = limit / sum;
      fadeIn *= scale;
      fadeOut *= scale;
    }
  }
  return { fadeInSec: fadeIn, fadeOutSec: fadeOut };
}

export async function playEditor(options: EditorPlayOptions): Promise<boolean> {
  const serial = ++startSerial;
  const ctx = await readyContext();
  if (serial !== startSerial) return false;

  const identity = isIdentity(options.params.speed, options.params.pitchSemitones);
  if (!identity) await registerWorklet(ctx);
  if (serial !== startSerial) return false;

  if (editorVoice) silenceVoiceNow(editorVoice);
  if (options.loop || bed?.bedOwner === "editor") cutBedNow();

  const offset =
    options.resumeOffset !== undefined ? options.resumeOffset : options.region.start;
  const voice = startVoice(ctx, {
    buffer: options.buffer,
    region: options.region,
    params: options.params,
    loop: options.loop,
    offset,
    fadeIn: true,
    itemId: options.itemId,
    bedOwner: options.loop ? "editor" : null,
  });
  editorVoice = voice;
  editorPhase = "playing";
  editorRegion = copyRegion(options.region);
  editorOffset = offset;
  if (options.loop) bed = voice;
  else oneshots.push(voice);
  return true;
}

export function pauseEditor(): void {
  const voice = editorVoice;
  if (editorPhase !== "playing" || !voice || !voice.active || voice.fading) return;
  editorOffset = derive(voice);
  voice.active = false;
  voice.token += 1;
  voice.source.onended = null;
  safeStop(voice.source);
  disconnectGraph(voice);
  editorPhase = "paused";
}

export function stopEditor(): void {
  const voice = editorVoice;
  editorPhase = "idle";
  editorOffset = voice?.region.start ?? editorRegion.start;
  if (voice && bed === voice) bed = null;
  if (!voice || voice.fading) return;
  if (!voice.active) {
    silenceVoiceNow(voice);
    return;
  }
  if (voice.loop) fadingBed = voice;
  beginFade(voice, voice.params.fadeOutSec);
}

export function silenceEditor(): void {
  if (
    editorPhase === "playing" &&
    editorVoice &&
    editorVoice.active &&
    !editorVoice.fading
  ) {
    editorOffset = derive(editorVoice);
  }
  if (editorVoice) {
    if (bed === editorVoice) bed = null;
    silenceVoiceNow(editorVoice);
  }
  editorPhase = "idle";
}

export function seekEditor(offset: number): void {
  const voice = editorVoice;
  if (editorPhase === "playing" && voice?.active && !voice.fading) {
    restartSource(voice, offset, false);
    editorOffset = offset;
    return;
  }
  editorOffset = offset;
}

export function setEditorRegion(region: RegionSec): void {
  const next = copyRegion(region);
  editorRegion = next;
  const voice = editorVoice;
  if (!voice || voice.released) return;
  if (editorPhase === "playing" && voice.active && !voice.fading && voice.loop) {
    const head = derive(voice);
    voice.region = next;
    voice.source.loopStart = next.start;
    voice.source.loopEnd = next.end;
    if (head < next.start || head >= next.end) restartSource(voice, next.start, false);
    return;
  }
  voice.region = next;
  if (
    editorPhase === "paused" &&
    (editorOffset < next.start || editorOffset >= next.end)
  ) {
    editorOffset = next.start;
  }
}

export function setEditorParams(params: TransportParams): void {
  const voice = editorVoice;
  if (!voice || voice.released) return;
  const nextIdentity = isIdentity(params.speed, params.pitchSemitones);
  const crossing = voice.usesWorklet === nextIdentity;
  const speedChanged = voice.params.speed !== params.speed;
  const pitchChanged = voice.params.pitchSemitones !== params.pitchSemitones;
  const playing = editorPhase === "playing" && voice.active && !voice.fading;
  const head = playing ? derive(voice) : editorOffset;
  voice.params = copyParams(params);
  voice.panner.pan.value = params.pan;
  if (!playing) return;
  if (crossing) {
    void rebuildFront(voice);
    return;
  }
  if (voice.stNode && (speedChanged || pitchChanged)) {
    voice.stNode.playbackRate.value = params.speed;
    voice.stNode.pitch.value = 1;
    voice.stNode.pitchSemitones.value = params.pitchSemitones;
  }
  if (!speedChanged) return;
  if (!voice.loop) {
    restartSource(voice, head, false);
    return;
  }
  const now = audioContextOf(voice).currentTime;
  voice.anchor = { contextTime: now, offset: head, speed: params.speed };
  voice.source.playbackRate.value = params.speed;
}

export function getEditorPhase(): EditorPhase {
  return editorPhase;
}

export function getEditorPlayhead(): number {
  if (
    editorPhase === "playing" &&
    editorVoice &&
    editorVoice.active &&
    !editorVoice.fading
  ) {
    return derive(editorVoice);
  }
  return editorOffset;
}

export function getBed(): BedState | null {
  if (!bed?.bedOwner) return null;
  return { owner: bed.bedOwner, itemId: bed.itemId };
}

export async function playListBed(options: ListPlayOptions): Promise<void> {
  const serial = ++startSerial;
  const ctx = await readyContext();
  if (serial !== startSerial) return;

  const identity = isIdentity(options.params.speed, options.params.pitchSemitones);
  if (!identity) await registerWorklet(ctx);
  if (serial !== startSerial) return;

  const editorWasBed = bed !== null && editorVoice === bed;
  if (
    editorWasBed &&
    editorVoice &&
    editorPhase === "playing" &&
    editorVoice.active &&
    !editorVoice.fading
  ) {
    editorOffset = derive(editorVoice);
  }
  cutBedNow();
  if (editorWasBed) editorPhase = "idle";

  bed = startVoice(ctx, {
    buffer: options.buffer,
    region: options.region,
    params: options.params,
    loop: true,
    offset: options.region.start,
    fadeIn: true,
    itemId: options.itemId,
    bedOwner: "list",
  });
}

export function stopBedByItem(itemId: string): boolean {
  if (!bed || bed.itemId !== itemId) return false;
  releaseBed(bed);
  return true;
}

export async function playListOneshot(options: ListPlayOptions): Promise<void> {
  const ctx = await readyContext();
  const identity = isIdentity(options.params.speed, options.params.pitchSemitones);
  if (!identity) await registerWorklet(ctx);
  oneshots.push(
    startVoice(ctx, {
      buffer: options.buffer,
      region: options.region,
      params: options.params,
      loop: false,
      offset: options.region.start,
      fadeIn: true,
      itemId: options.itemId,
      bedOwner: null,
    }),
  );
}

export function stopVoicesForItem(itemId: string): void {
  if (bed && bed.itemId === itemId) releaseBed(bed);
  const targets = oneshots.filter((voice) => voice.itemId === itemId);
  for (const voice of targets) fadeStop(voice, true);
}

function registerWorklet(ctx: AudioContext): Promise<void> {
  const existing = worklets.get(ctx);
  if (existing) return existing;
  const pending = SoundTouchNode.register(ctx, processorUrl);
  worklets.set(ctx, pending);
  void pending.catch(() => {
    if (worklets.get(ctx) === pending) worklets.delete(ctx);
  });
  return pending;
}

async function readyContext(): Promise<AudioContext> {
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

function isIdentity(speed: number, pitchSemitones: number): boolean {
  return speed === 1 && pitchSemitones === 0;
}

function copyRegion(region: RegionSec): RegionSec {
  return { start: region.start, end: region.end };
}

function copyParams(params: TransportParams): TransportParams {
  return {
    speed: params.speed,
    pitchSemitones: params.pitchSemitones,
    pan: params.pan,
    fadeInSec: params.fadeInSec,
    fadeOutSec: params.fadeOutSec,
  };
}

function audioContextOf(voice: Voice): AudioContext {
  const ctx = voice.gain.context;
  if (!(ctx instanceof AudioContext)) {
    throw new Error("Voice is not attached to an AudioContext");
  }
  return ctx;
}

function derive(voice: Voice): number {
  const elapsed = audioContextOf(voice).currentTime - voice.anchor.contextTime;
  const position = voice.anchor.offset + elapsed * voice.anchor.speed;
  if (!voice.loop) return position;
  return wrap(position, voice.region);
}

function wrap(position: number, region: RegionSec): number {
  const span = region.end - region.start;
  if (!(span > 0)) return region.start;
  const rel = position - region.start;
  const mod = ((rel % span) + span) % span;
  return region.start + mod;
}

type StartInput = {
  buffer: AudioBuffer;
  region: RegionSec;
  params: TransportParams;
  loop: boolean;
  offset: number;
  fadeIn: boolean;
  itemId: string | null;
  bedOwner: BedOwner | null;
};

function startVoice(ctx: AudioContext, input: StartInput): Voice {
  const params = copyParams(input.params);
  const identity = isIdentity(params.speed, params.pitchSemitones);
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  gain.gain.value = 1;
  panner.pan.value = params.pan;
  gain.connect(panner);
  panner.connect(ctx.destination);

  let stNode: SoundTouchNode | null = null;
  if (!identity) {
    stNode = new SoundTouchNode({ context: ctx });
    applyWorklet(stNode, params);
    stNode.connect(gain);
  }

  const voice: Voice = {
    itemId: input.itemId,
    loop: input.loop,
    bedOwner: input.bedOwner,
    buffer: input.buffer,
    region: copyRegion(input.region),
    params,
    scheduledFadeOut: params.fadeOutSec,
    source: ctx.createBufferSource(),
    stNode,
    gain,
    panner,
    anchor: { contextTime: 0, offset: input.offset, speed: params.speed },
    fadeInEndsAt: 0,
    active: true,
    fading: false,
    released: false,
    usesWorklet: stNode !== null,
    token: 1,
  };
  mountSource(voice, input.offset, input.fadeIn);
  return voice;
}

function mountSource(voice: Voice, offset: number, fadeIn: boolean): void {
  const ctx = audioContextOf(voice);
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = voice.buffer;
  source.loop = voice.loop;
  source.loopStart = voice.region.start;
  source.loopEnd = voice.region.end;
  source.playbackRate.value = voice.params.speed;
  if (voice.stNode) source.connect(voice.stNode);
  else source.connect(voice.gain);
  voice.source = source;
  voice.anchor = { contextTime: now, offset, speed: voice.params.speed };
  voice.active = true;
  const stopAt = voice.loop ? null : stopTime(voice, now, offset);
  if (fadeIn) {
    armFadeIn(voice, now);
    if (stopAt !== null) armOneshotFadeOut(voice, now, stopAt);
  } else {
    preserveGain(voice, now, stopAt);
  }
  source.start(now, offset);
  if (stopAt !== null) safeStopAt(source, stopAt);
  watchSource(voice, source);
}

function restartSource(voice: Voice, offset: number, fadeIn: boolean): void {
  voice.token += 1;
  const previous = voice.source;
  previous.onended = null;
  safeDisconnect(previous);
  safeStop(previous);
  mountSource(voice, offset, fadeIn);
}

async function rebuildFront(voice: Voice): Promise<void> {
  const serial = ++graphSerial;
  const ctx = audioContextOf(voice);
  const identity = isIdentity(voice.params.speed, voice.params.pitchSemitones);
  if (!identity) await registerWorklet(ctx);
  if (
    serial !== graphSerial ||
    voice.released ||
    editorVoice !== voice ||
    editorPhase !== "playing" ||
    !voice.active ||
    voice.fading
  ) {
    return;
  }
  const head = derive(voice);
  voice.token += 1;
  const previous = voice.source;
  previous.onended = null;
  safeDisconnect(previous);
  safeStop(previous);
  if (voice.stNode) {
    safeDisconnect(voice.stNode);
    voice.stNode = null;
  }
  if (!identity) {
    const stNode = new SoundTouchNode({ context: ctx });
    applyWorklet(stNode, voice.params);
    stNode.connect(voice.gain);
    voice.stNode = stNode;
  }
  voice.usesWorklet = !identity;
  mountSource(voice, head, false);
}

function applyWorklet(stNode: SoundTouchNode, params: TransportParams): void {
  stNode.playbackRate.value = params.speed;
  stNode.pitch.value = 1;
  stNode.pitchSemitones.value = params.pitchSemitones;
}

function stopTime(voice: Voice, now: number, offset: number): number {
  const remaining = voice.region.end - offset;
  if (!(voice.params.speed > 0) || !(remaining > 0)) return now;
  return now + remaining / voice.params.speed;
}

function armFadeIn(voice: Voice, now: number): void {
  const fadeIn = voice.params.fadeInSec;
  const gain = voice.gain.gain;
  gain.cancelScheduledValues(now);
  if (!(fadeIn > 0)) {
    gain.setValueAtTime(1, now);
    voice.fadeInEndsAt = now;
    return;
  }
  gain.setValueAtTime(0, now);
  gain.linearRampToValueAtTime(1, now + fadeIn);
  voice.fadeInEndsAt = now + fadeIn;
}

function armOneshotFadeOut(voice: Voice, now: number, stopAt: number): void {
  const fadeOut = voice.scheduledFadeOut;
  if (!(fadeOut > 0) || !(stopAt > now) || !(stopAt > voice.fadeInEndsAt)) return;
  const fadeOutStart = Math.max(now, stopAt - fadeOut);
  const gain = voice.gain.gain;
  if (fadeOutStart > now && fadeOutStart > voice.fadeInEndsAt) {
    gain.setValueAtTime(1, fadeOutStart);
  }
  gain.linearRampToValueAtTime(0, stopAt);
}

function preserveGain(voice: Voice, now: number, stopAt: number | null): void {
  const gain = voice.gain.gain;
  if (now + 1e-4 < voice.fadeInEndsAt) {
    if (stopAt !== null) {
      gain.cancelScheduledValues(voice.fadeInEndsAt + 1e-4);
      armOneshotFadeOut(voice, now, stopAt);
    }
    return;
  }
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(1, now);
  if (stopAt !== null) armOneshotFadeOut(voice, now, stopAt);
}

function watchSource(voice: Voice, source: AudioBufferSourceNode): void {
  const token = voice.token;
  source.onended = () => {
    if (voice.token !== token || voice.source !== source || voice.released) return;
    if (voice.fading) {
      silenceVoiceNow(voice);
      return;
    }
    if (!voice.active || voice.loop) return;
    if (editorVoice === voice && editorPhase === "playing") {
      editorOffset = voice.region.end;
      editorPhase = "idle";
    }
    silenceVoiceNow(voice);
  };
}

function beginFade(voice: Voice, fadeSec: number): void {
  if (!voice.active || voice.fading || voice.released) return;
  if (!(fadeSec > 0)) {
    silenceVoiceNow(voice);
    return;
  }
  voice.fading = true;
  const now = audioContextOf(voice).currentTime;
  const gain = voice.gain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(0, now + fadeSec);
  const stopAt = now + fadeSec;
  let scheduled = true;
  try {
    voice.source.stop(stopAt);
  } catch {
    // A one-shot already used its only stop() call at start.
    scheduled = false;
  }
  const token = voice.token;
  const finish = () => {
    if (voice.token !== token || voice.released || !voice.fading) return;
    silenceVoiceNow(voice);
  };
  voice.source.onended = finish;
  if (!scheduled) window.setTimeout(finish, fadeSec * 1000);
}

function fadeStop(voice: Voice, editorAware: boolean): void {
  const wasEditor = editorAware && editorVoice === voice;
  if (wasEditor && editorPhase === "playing" && voice.active && !voice.fading) {
    editorOffset = derive(voice);
  }
  if (wasEditor) editorPhase = "idle";
  if (voice.loop && (bed === voice || fadingBed === voice)) {
    if (bed === voice) bed = null;
    fadingBed = voice;
  }
  if (voice.active && !voice.fading) beginFade(voice, voice.params.fadeOutSec);
  else silenceVoiceNow(voice);
}

function releaseBed(voice: Voice): void {
  fadeStop(voice, true);
}

function cutBedNow(): void {
  if (fadingBed) silenceVoiceNow(fadingBed);
  if (bed) silenceVoiceNow(bed);
}

function silenceVoiceNow(voice: Voice): void {
  if (voice.released) return;
  voice.released = true;
  voice.active = false;
  voice.fading = false;
  voice.token += 1;
  voice.source.onended = null;
  safeStop(voice.source);
  disconnectGraph(voice);
  if (bed === voice) bed = null;
  if (fadingBed === voice) fadingBed = null;
  if (editorVoice === voice) editorVoice = null;
  oneshots = oneshots.filter((item) => item !== voice);
}

function disconnectGraph(voice: Voice): void {
  safeDisconnect(voice.source);
  if (voice.stNode) safeDisconnect(voice.stNode);
  safeDisconnect(voice.gain);
  safeDisconnect(voice.panner);
}

function safeStop(source: AudioBufferSourceNode): void {
  try {
    source.stop();
  } catch {
    // stop() throws when the source never started or stop() already ran.
  }
}

function safeStopAt(source: AudioBufferSourceNode, when: number): void {
  try {
    source.stop(when);
  } catch {
    // stop() throws when the source never started or stop() already ran.
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // disconnect() throws when the node is already disconnected.
  }
}
