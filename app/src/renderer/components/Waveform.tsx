import WavesurferPlayer from "@wavesurfer/react";
import WaveSurfer from "wavesurfer.js";
import { useState } from "react";

export default function Waveform({ audioUrl }: { audioUrl: string }) {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const onReady = (ws: WaveSurfer) => {
    setWavesurfer(ws);
    setIsPlaying(false);
  };

  const onPlayPause = () => {
    if (!wavesurfer) return;
    wavesurfer.playPause();
  };

  return (
    <div className="flex flex-col gap-2">
      <WavesurferPlayer
        height={100}
        waveColor="violet"
        url={audioUrl}
        onReady={onReady}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <button onClick={onPlayPause}>{isPlaying ? "Pause" : "Play"}</button>
    </div>
  );
}
