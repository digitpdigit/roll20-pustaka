import WavesurferPlayer from "@wavesurfer/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
// eslint-disable-next-line import/no-unresolved -- package export map; same waiver as the worklet URL
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";

const MIN_REGION_SEC = 0.05;

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

  const onReady = (ws: WaveSurfer, duration: number) => {
    setWavesurfer(ws);
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

  return (
    <WavesurferPlayer
      height={100}
      waveColor="violet"
      url={audioUrl}
      plugins={plugins}
      onReady={onReady}
      onInteraction={onInteraction}
    />
  );
}
