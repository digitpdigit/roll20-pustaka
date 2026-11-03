import WavesurferPlayer from "@wavesurfer/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
// eslint-disable-next-line import/no-unresolved -- package export map; same waiver as the worklet URL
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";

const MIN_REGION_SEC = 0.05;
const MAX_PX_PER_SEC = 4000;

type WaveformProps = {
  audioUrl: string;
  start: number;
  end: number;
  playhead: number;
  regionEpoch: number;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
};

export default function Waveform({
  audioUrl,
  start,
  end,
  playhead,
  regionEpoch,
  onRegionChange,
  onSeek,
}: WaveformProps) {
  // A new plugins array on each render makes @wavesurfer/react rebuild the player.
  const plugins = useMemo(() => [RegionsPlugin.create()], []);
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
  const [pxPerSec, setPxPerSec] = useState(0);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const pxPerSecRef = useRef(0);
  const regionRef = useRef<Region | null>(null);
  const ignoreRegionRef = useRef(false);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const onRegionChangeRef = useRef(onRegionChange);
  const onSeekRef = useRef(onSeek);
  const seenUrlRef = useRef(audioUrl);

  startRef.current = start;
  endRef.current = end;
  onRegionChangeRef.current = onRegionChange;
  onSeekRef.current = onSeek;
  if (seenUrlRef.current !== audioUrl) {
    seenUrlRef.current = audioUrl;
    regionRef.current = null;
  }

  const applyZoom = (next: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const value = next <= 0 ? 0 : Math.min(MAX_PX_PER_SEC, next);
    pxPerSecRef.current = value;
    setPxPerSec(value);
    ws.zoom(value);
  };

  const fittedPxPerSec = () => {
    const ws = wavesurferRef.current;
    if (!ws) return 0;
    const duration = ws.getDuration();
    if (!(duration > 0)) return 0;
    const viewport = ws.getWrapper().parentElement?.clientWidth ?? ws.getWidth();
    return viewport / duration;
  };

  const zoomIn = () => {
    const base = pxPerSecRef.current > 0 ? pxPerSecRef.current : fittedPxPerSec();
    if (!(base > 0) || base >= MAX_PX_PER_SEC) return;
    applyZoom(base * 2);
  };

  const zoomOut = () => {
    if (pxPerSecRef.current <= 0) return;
    const next = pxPerSecRef.current / 2;
    applyZoom(next <= fittedPxPerSec() * 1.05 ? 0 : next);
  };

  const onReady = (ws: WaveSurfer, duration: number) => {
    wavesurferRef.current = ws;
    pxPerSecRef.current = 0;
    setPxPerSec(0);
    setWavesurfer(ws);
    ws.zoom(0);
    const regions = plugins[0];
    regions.clearRegions();
    regionRef.current = null;
    if (!(duration >= MIN_REGION_SEC)) return;

    ignoreRegionRef.current = true;
    const region = regions.addRegion({
      start: startRef.current,
      end: endRef.current,
      minLength: MIN_REGION_SEC,
    });
    regionRef.current = region;
    ignoreRegionRef.current = false;

    const emit = () => {
      if (ignoreRegionRef.current) return;
      onRegionChangeRef.current(region.start, region.end);
    };
    region.on("update", emit);
    region.on("update-end", emit);
  };

  const onInteraction = (_ws: WaveSurfer, time: number) => {
    onSeekRef.current(time);
  };

  useEffect(() => {
    const region = regionRef.current;
    if (!region || region.isRemoved) return;
    ignoreRegionRef.current = true;
    region.setOptions({ start: startRef.current, end: endRef.current });
    ignoreRegionRef.current = false;
  }, [audioUrl, regionEpoch]);

  useEffect(() => {
    if (!wavesurfer) return;
    try {
      wavesurfer.setTime(playhead);
    } catch {
      // The player can be destroyed while a playhead frame is still in flight.
    }
  }, [playhead, wavesurfer]);

  const length = end - start;
  const zoomLabel = pxPerSec > 0 ? `${Math.round(pxPerSec)} px/s` : "Fit";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="border border-gray-300 rounded-md px-2 py-1"
          disabled={!wavesurfer || pxPerSec <= 0}
          onClick={zoomOut}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="border border-gray-300 rounded-md px-2 py-1"
          disabled={!wavesurfer || pxPerSec >= MAX_PX_PER_SEC}
          onClick={zoomIn}
        >
          Zoom in
        </button>
        <button
          type="button"
          className="border border-gray-300 rounded-md px-2 py-1"
          disabled={!wavesurfer || pxPerSec <= 0}
          onClick={() => applyZoom(0)}
        >
          Fit
        </button>
        <span>{zoomLabel}</span>
        <span>
          {formatSec(start)} – {formatSec(end)} · length {formatSec(length)}
        </span>
      </div>
      <WavesurferPlayer
        height={100}
        waveColor="violet"
        url={audioUrl}
        plugins={plugins}
        onReady={onReady}
        onInteraction={onInteraction}
      />
    </div>
  );
}

function formatSec(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(3)} s`;
}
