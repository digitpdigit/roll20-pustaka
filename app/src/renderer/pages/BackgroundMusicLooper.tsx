import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { resolveSave } from "../../library/saveAction";
import type { ItemType, LibraryItem, UpdateItemFields } from "../../library/types";
import {
  clampFades,
  decodeAudio,
  getBed,
  getEditorPhase,
  getEditorPlayhead,
  pauseEditor,
  playEditor,
  playListBed,
  playListOneshot,
  seekEditor,
  setEditorParams,
  setEditorRegion,
  silenceEditor,
  stopBedByItem,
  stopEditor,
  stopVoicesForItem,
} from "../audio/engine";
import type { RegionSec, TransportParams } from "../audio/engine";
import LibraryList from "../components/LibraryList";
import LoopTransport from "../components/LoopTransport";
import Waveform from "../components/Waveform";

/**
 * Upload an audio file, mark one region, and play it through the audio engine.
 * Save that region as a looping bed or a soundboard one-shot.
 */
const MIN_REGION_SEC = 0.05;

const DEFAULT_PARAMS: TransportParams = {
  speed: 1,
  pitchSemitones: 0,
  pan: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
};

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Request failed";
}

function displayName(filename: string): string {
  const match = filename.match(/^(.*)\.[A-Za-z0-9]{1,8}$/);
  if (!match || match[1].length === 0) return filename;
  return match[1];
}

function mimeFor(file: File): string {
  if (file.type !== "") return file.type;
  const match = file.name.match(/\.([A-Za-z0-9]{1,8})$/);
  if (!match) return "application/octet-stream";
  switch (match[1].toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function paramsFromItem(item: LibraryItem): TransportParams {
  return {
    speed: item.speed,
    pitchSemitones: item.pitchSemitones,
    pan: item.pan,
    fadeInSec: item.fadeInSec,
    fadeOutSec: item.fadeOutSec,
  };
}

function editorLoops(item: LibraryItem | null): boolean {
  return item?.type !== "soundboard";
}

export default function BackgroundMusicLooper() {
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LibraryItem | null>(null);
  const [region, setRegion] = useState<RegionSec>({ start: 0, end: 0 });
  const [params, setParams] = useState<TransportParams>(DEFAULT_PARAMS);
  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [mime, setMime] = useState("application/octet-stream");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [regionEpoch, setRegionEpoch] = useState(0);

  const fileBytesRef = useRef(fileBytes);
  const bufferRef = useRef(buffer);
  const loadedRef = useRef(loaded);
  const regionRef = useRef(region);
  const paramsRef = useRef(params);
  const nameRef = useRef(name);
  const originalNameRef = useRef(originalName);
  const mimeRef = useRef(mime);
  const urlRef = useRef<string | null>(null);
  const editorGenRef = useRef(0);
  const voiceGenRef = useRef<number | null>(null);
  const liveGenRef = useRef<number | null>(null);
  const playInFlightRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const editorReqRef = useRef(0);
  const bedReqRef = useRef(0);
  const transportCmdRef = useRef<{
    id: number;
    kind: "play" | "pause" | "stop" | "supersede";
  }>({ id: 0, kind: "play" });
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  fileBytesRef.current = fileBytes;
  bufferRef.current = buffer;
  loadedRef.current = loaded;
  regionRef.current = region;
  paramsRef.current = params;
  nameRef.current = name;
  originalNameRef.current = originalName;
  mimeRef.current = mime;

  const stopFrames = () => {
    if (rafRef.current === null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const startFrames = () => {
    stopFrames();
    const tick = () => {
      if (
        !mountedRef.current ||
        getEditorPhase() !== "playing" ||
        liveGenRef.current !== editorGenRef.current
      ) {
        rafRef.current = null;
        return;
      }
      setPlayhead(getEditorPlayhead());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const replaceUrl = (next: string | null) => {
    if (urlRef.current && urlRef.current !== next) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setAudioUrl(next);
  };

  const voiceMatchesEditor = () => liveGenRef.current === editorGenRef.current;

  const pushParams = (next: TransportParams, span: number) => {
    if (!voiceMatchesEditor()) return;
    const fades = clampFades(
      span,
      next.fadeInSec,
      next.fadeOutSec,
      editorLoops(loadedRef.current),
    );
    setEditorParams({
      speed: next.speed,
      pitchSemitones: next.pitchSemitones,
      pan: next.pan,
      fadeInSec: fades.fadeInSec,
      fadeOutSec: fades.fadeOutSec,
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    let listActive = true;
    window.libraryAPI
      .list()
      .then((next) => {
        if (listActive) setItems(next);
      })
      .catch((listError: unknown) => {
        if (listActive) setError(errorText(listError));
      });
    return () => {
      listActive = false;
      mountedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const token = ++editorReqRef.current;
    transportCmdRef.current = {
      id: transportCmdRef.current.id + 1,
      kind: "supersede",
    };
    silenceEditor();
    liveGenRef.current = null;
    pendingSeekRef.current = null;
    stopFrames();
    setLoaded(null);
    setParams(DEFAULT_PARAMS);
    setName(displayName(file.name));
    setOriginalName(file.name);
    setMime(mimeFor(file));
    setFileBytes(null);
    setBuffer(null);
    setRegion({ start: 0, end: 0 });
    setPlayhead(0);
    setError(null);
    replaceUrl(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!mountedRef.current || editorReqRef.current !== token) return;
      setFileBytes(bytes);
      const audio = await decodeAudio(bytes);
      if (!mountedRef.current || editorReqRef.current !== token) return;
      editorGenRef.current += 1;
      const url = URL.createObjectURL(file);
      if (!mountedRef.current || editorReqRef.current !== token) {
        URL.revokeObjectURL(url);
        return;
      }
      setBuffer(audio);
      setRegion({ start: 0, end: audio.duration });
      setPlayhead(0);
      setRegionEpoch((epoch) => epoch + 1);
      replaceUrl(url);
      if (audio.duration < MIN_REGION_SEC) {
        setError("Audio is shorter than 0.05 seconds");
      }
    } catch (decodeError: unknown) {
      if (mountedRef.current && editorReqRef.current === token) {
        setError(errorText(decodeError));
      }
    }
  };

  const onParamsChange = (next: TransportParams) => {
    setParams(next);
    const span = regionRef.current.end - regionRef.current.start;
    pushParams(next, span);
  };

  const onRegionChange = (start: number, end: number) => {
    const next = { start, end };
    setRegion(next);
    if (!voiceMatchesEditor()) return;
    setEditorRegion(next);
    pushParams(paramsRef.current, end - start);
    if (getEditorPhase() === "paused") setPlayhead(getEditorPlayhead());
  };

  const onSeek = (time: number) => {
    const current = regionRef.current;
    const lo = Math.min(current.start, current.end);
    const hi = Math.max(current.start, current.end);
    const next = Math.min(hi, Math.max(lo, time));
    setPlayhead(next);
    if (!voiceMatchesEditor()) {
      if (playInFlightRef.current === editorGenRef.current) pendingSeekRef.current = next;
      return;
    }
    pendingSeekRef.current = null;
    const phase = getEditorPhase();
    if (phase === "playing" || phase === "paused") seekEditor(next);
  };

  const onPlay = async () => {
    const audio = bufferRef.current;
    const currentRegion = regionRef.current;
    if (!audio || audio.duration < MIN_REGION_SEC) return;
    if (currentRegion.end - currentRegion.start < MIN_REGION_SEC) return;

    const commandId = transportCmdRef.current.id + 1;
    transportCmdRef.current = { id: commandId, kind: "play" };
    const loop = editorLoops(loadedRef.current);
    const currentParams = paramsRef.current;
    const fades = clampFades(
      currentRegion.end - currentRegion.start,
      currentParams.fadeInSec,
      currentParams.fadeOutSec,
      loop,
    );
    const gen = editorGenRef.current;
    const previousVoice = voiceGenRef.current;
    const resumeOffset =
      getEditorPhase() === "paused" && liveGenRef.current === gen
        ? getEditorPlayhead()
        : undefined;
    const startedRegion = { start: currentRegion.start, end: currentRegion.end };
    voiceGenRef.current = gen;
    playInFlightRef.current = gen;
    pendingSeekRef.current = null;

    const adoptEditorVoice = () => {
      liveGenRef.current = gen;
      const latest = regionRef.current;
      const regionChanged =
        latest.start !== startedRegion.start || latest.end !== startedRegion.end;
      setEditorRegion(latest);
      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;
      const phase = getEditorPhase();
      if (pending !== null && (phase === "playing" || phase === "paused")) {
        const offset = Math.min(latest.end, Math.max(latest.start, pending));
        seekEditor(offset);
        if (mountedRef.current) setPlayhead(offset);
      } else if (regionChanged && !loop && phase === "playing") {
        const head = getEditorPlayhead();
        const offset = head < latest.start || head >= latest.end ? latest.start : head;
        seekEditor(offset);
      }
      pushParams(paramsRef.current, latest.end - latest.start);
      if (getEditorPhase() === "paused" && mountedRef.current) {
        setPlayhead(getEditorPlayhead());
      }
    };

    const reconcileStalePlay = () => {
      const command = transportCmdRef.current;
      const stale = command.id !== commandId || editorGenRef.current !== gen;
      if (!stale) return false;
      if (voiceGenRef.current !== gen) return true;
      if (command.kind === "play" && editorGenRef.current === gen) return true;
      if (command.kind === "pause") {
        pauseEditor();
        adoptEditorVoice();
        return true;
      }
      if (command.kind === "stop") {
        pendingSeekRef.current = null;
        stopEditor();
        liveGenRef.current = gen;
        if (mountedRef.current) setPlayhead(regionRef.current.start);
        return true;
      }
      silenceEditor();
      liveGenRef.current = null;
      voiceGenRef.current = previousVoice;
      pendingSeekRef.current = null;
      return true;
    };

    try {
      let started = false;
      try {
        started = await playEditor({
          buffer: audio,
          region: startedRegion,
          params: {
            speed: currentParams.speed,
            pitchSemitones: currentParams.pitchSemitones,
            pan: currentParams.pan,
            fadeInSec: fades.fadeInSec,
            fadeOutSec: fades.fadeOutSec,
          },
          loop,
          itemId: loadedRef.current?.id ?? null,
          ...(resumeOffset !== undefined ? { resumeOffset } : {}),
        });
      } catch (playError: unknown) {
        if (!reconcileStalePlay() && voiceGenRef.current === gen) {
          voiceGenRef.current = previousVoice;
        }
        if (mountedRef.current) setError(errorText(playError));
        return;
      }
      if (!started) {
        if (
          voiceGenRef.current === gen &&
          transportCmdRef.current.id === commandId
        ) {
          voiceGenRef.current = previousVoice;
        }
        return;
      }
      if (!mountedRef.current) return;
      if (reconcileStalePlay()) return;
      adoptEditorVoice();
      if (getEditorPhase() === "playing") startFrames();
    } finally {
      if (playInFlightRef.current === gen) playInFlightRef.current = null;
    }
  };

  const onPause = () => {
    transportCmdRef.current = {
      id: transportCmdRef.current.id + 1,
      kind: "pause",
    };
    pauseEditor();
    stopFrames();
    if (voiceMatchesEditor()) setPlayhead(getEditorPlayhead());
  };

  const onStop = () => {
    transportCmdRef.current = {
      id: transportCmdRef.current.id + 1,
      kind: "stop",
    };
    const start = regionRef.current.start;
    stopEditor();
    stopFrames();
    setPlayhead(start);
  };

  const fieldsFromEditor = (source: LibraryItem | null): UpdateItemFields => {
    const currentRegion = regionRef.current;
    const currentParams = paramsRef.current;
    const fades = clampFades(
      currentRegion.end - currentRegion.start,
      currentParams.fadeInSec,
      currentParams.fadeOutSec,
      editorLoops(source),
    );
    return {
      name: nameRef.current,
      originalName: source ? source.originalName : originalNameRef.current,
      mime: source ? source.mime : mimeRef.current,
      start: currentRegion.start,
      end: currentRegion.end,
      speed: currentParams.speed,
      pitchSemitones: currentParams.pitchSemitones,
      pan: currentParams.pan,
      fadeInSec: fades.fadeInSec,
      fadeOutSec: fades.fadeOutSec,
    };
  };

  const save = async (action: ItemType) => {
    const token = editorReqRef.current;
    const source = loadedRef.current;
    const bytes = fileBytesRef.current;
    setError(null);
    let saved: LibraryItem | null = null;
    try {
      const decision = resolveSave(source, action);
      let created: LibraryItem;
      if (decision.kind === "update") {
        if (!source) return;
        created = await window.libraryAPI.update({
          id: source.id,
          fields: fieldsFromEditor(source),
        });
      } else if (source) {
        const fields = fieldsFromEditor(source);
        created = await window.libraryAPI.create({
          ...fields,
          type: decision.type,
          fileHash: source.fileHash,
          originalName: source.originalName,
          mime: source.mime,
        });
      } else {
        if (!bytes) return;
        const put = await window.libraryAPI.putAudio({
          bytes: new Uint8Array(bytes),
          originalName: originalNameRef.current,
        });
        if (!mountedRef.current || editorReqRef.current !== token) return;
        created = await window.libraryAPI.create({
          ...fieldsFromEditor(null),
          type: decision.type,
          fileHash: put.fileHash,
        });
      }
      saved = created;
      if (!mountedRef.current) return;
      if (editorReqRef.current === token) setLoaded(saved);
      const next = await window.libraryAPI.list();
      if (mountedRef.current) setItems(next);
    } catch (saveError: unknown) {
      if (!mountedRef.current) return;
      if (saved) {
        const kept = saved;
        setItems((current) => {
          const index = current.findIndex((row) => row.id === kept.id);
          if (index < 0) return [...current, kept];
          const next = current.slice();
          next[index] = kept;
          return next;
        });
      }
      setError(errorText(saveError));
    }
  };

  const onLoad = async (item: LibraryItem) => {
    const token = ++editorReqRef.current;
    setError(null);
    try {
      const raw = await window.libraryAPI.readAudio({ fileHash: item.fileHash });
      if (!mountedRef.current || editorReqRef.current !== token) return;
      const bytes = Uint8Array.from(raw);
      const audio = await decodeAudio(bytes);
      if (!mountedRef.current || editorReqRef.current !== token) return;
      editorGenRef.current += 1;
      const url = URL.createObjectURL(
        new Blob([bytes], { type: item.mime || "application/octet-stream" }),
      );
      if (!mountedRef.current || editorReqRef.current !== token) {
        URL.revokeObjectURL(url);
        return;
      }
      stopFrames();
      setFileBytes(bytes);
      setBuffer(audio);
      setOriginalName(item.originalName);
      setMime(item.mime);
      setName(item.name);
      setRegion({ start: item.start, end: item.end });
      setParams(paramsFromItem(item));
      setLoaded(item);
      setPlayhead(item.start);
      setRegionEpoch((epoch) => epoch + 1);
      replaceUrl(url);
      if (audio.duration < MIN_REGION_SEC) {
        setError("Audio is shorter than 0.05 seconds");
      }
    } catch (loadError: unknown) {
      if (mountedRef.current && editorReqRef.current === token) {
        setError(errorText(loadError));
      }
    }
  };

  const onPlayItem = async (item: LibraryItem) => {
    if (item.type === "bgm") {
      if (getBed()?.itemId === item.id) {
        stopBedByItem(item.id);
        if (getEditorPhase() !== "playing") stopFrames();
        return;
      }
      const token = ++bedReqRef.current;
      const commandId = transportCmdRef.current.id;
      try {
        const raw = await window.libraryAPI.readAudio({ fileHash: item.fileHash });
        if (!mountedRef.current || bedReqRef.current !== token) return;
        const bytes = Uint8Array.from(raw);
        const audio = await decodeAudio(bytes);
        if (!mountedRef.current || bedReqRef.current !== token) return;
        if (
          transportCmdRef.current.kind === "play" &&
          transportCmdRef.current.id !== commandId
        ) {
          return;
        }
        await playListBed({
          itemId: item.id,
          buffer: audio,
          region: { start: item.start, end: item.end },
          params: paramsFromItem(item),
        });
        if (getEditorPhase() !== "playing") stopFrames();
      } catch (playError: unknown) {
        if (mountedRef.current && bedReqRef.current === token) {
          setError(errorText(playError));
        }
      }
      return;
    }

    try {
      const raw = await window.libraryAPI.readAudio({ fileHash: item.fileHash });
      if (!mountedRef.current) return;
      const bytes = Uint8Array.from(raw);
      const audio = await decodeAudio(bytes);
      if (!mountedRef.current) return;
      await playListOneshot({
        itemId: item.id,
        buffer: audio,
        region: { start: item.start, end: item.end },
        params: paramsFromItem(item),
      });
    } catch (playError: unknown) {
      if (mountedRef.current) setError(errorText(playError));
    }
  };

  const onRename = async (item: LibraryItem, nextName: string) => {
    setError(null);
    let updated: LibraryItem;
    try {
      updated = await window.libraryAPI.rename({ id: item.id, name: nextName });
    } catch (renameError: unknown) {
      if (mountedRef.current) setError(errorText(renameError));
      throw renameError;
    }
    if (!mountedRef.current) return;
    if (loadedRef.current?.id === updated.id) {
      setLoaded(updated);
      setName(updated.name);
    }
    try {
      const next = await window.libraryAPI.list();
      if (mountedRef.current) setItems(next);
    } catch (listError: unknown) {
      if (!mountedRef.current) return;
      setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setError(errorText(listError));
    }
  };

  const onDelete = async (item: LibraryItem) => {
    setError(null);
    let deleted = false;
    try {
      await window.libraryAPI.delete({ id: item.id });
      deleted = true;
      stopVoicesForItem(item.id);
      if (getEditorPhase() !== "playing") stopFrames();
      if (loadedRef.current?.id === item.id) setLoaded(null);
      const next = await window.libraryAPI.list();
      if (mountedRef.current) setItems(next);
    } catch (deleteError: unknown) {
      if (!mountedRef.current) return;
      if (deleted) {
        setItems((current) => current.filter((row) => row.id !== item.id));
      }
      setError(errorText(deleteError));
    }
  };

  const transportDisabled = buffer === null || buffer.duration < MIN_REGION_SEC;
  const saveDisabled =
    transportDisabled || region.end - region.start < MIN_REGION_SEC;

  return (
    <div className="flex flex-col gap-4">
      <h1>Background Music Looper</h1>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium border-b w-fit">Background Music</h2>
          <input
            type="file"
            onChange={(event) => void onFile(event)}
            className="border border-gray-300 rounded-md p-2 w-fit"
          />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium border-b w-fit">Waveform</h2>
          {audioUrl ? (
            <Waveform
              audioUrl={audioUrl}
              start={region.start}
              end={region.end}
              playhead={playhead}
              regionEpoch={regionEpoch}
              onRegionChange={onRegionChange}
              onSeek={onSeek}
            />
          ) : null}
        </div>
        <LoopTransport
          disabled={transportDisabled}
          saveDisabled={saveDisabled}
          name={name}
          params={params}
          onNameChange={setName}
          onParamsChange={onParamsChange}
          onPlay={() => void onPlay()}
          onPause={onPause}
          onStop={onStop}
          onSaveLoop={() => void save("bgm")}
          onSaveSoundboard={() => void save("soundboard")}
        />
        <LibraryList
          items={items}
          error={error}
          onPlay={(item) => void onPlayItem(item)}
          onLoad={(item) => void onLoad(item)}
          onDelete={(item) => void onDelete(item)}
          onRename={onRename}
        />
      </div>
    </div>
  );
}
