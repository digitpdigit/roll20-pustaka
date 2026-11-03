import type { TransportParams } from "../audio/engine";

type LoopTransportProps = {
  disabled: boolean;
  saveDisabled: boolean;
  name: string;
  params: TransportParams;
  onNameChange: (name: string) => void;
  onParamsChange: (params: TransportParams) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSaveLoop: () => void;
  onSaveSoundboard: () => void;
};

const buttonClass = "border border-gray-300 rounded-md px-2 py-1";

export default function LoopTransport({
  disabled,
  saveDisabled,
  name,
  params,
  onNameChange,
  onParamsChange,
  onPlay,
  onPause,
  onStop,
  onSaveLoop,
  onSaveSoundboard,
}: LoopTransportProps) {
  const savesDisabled = disabled || saveDisabled;

  const setParam = (patch: Partial<TransportParams>) => {
    onParamsChange({ ...params, ...patch });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={disabled} onClick={onPlay}>
          Play
        </button>
        <button type="button" className={buttonClass} disabled={disabled} onClick={onPause}>
          Pause
        </button>
        <button type="button" className={buttonClass} disabled={disabled} onClick={onStop}>
          Stop
        </button>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          type="text"
          value={name}
          disabled={disabled}
          onChange={(event) => onNameChange(event.target.value)}
          className="border border-gray-300 rounded-md p-2 w-fit"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-20">Speed</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.01}
          value={params.speed}
          disabled={disabled}
          onChange={(event) => setParam({ speed: Number(event.target.value) })}
          className="flex-1"
        />
        <span className="w-12 text-right">{params.speed.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-20">Pitch</span>
        <input
          type="range"
          min={-12}
          max={12}
          step={1}
          value={params.pitchSemitones}
          disabled={disabled}
          onChange={(event) =>
            setParam({ pitchSemitones: Math.round(Number(event.target.value)) })
          }
          className="flex-1"
        />
        <span className="w-12 text-right">{params.pitchSemitones}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-20">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={params.pan}
          disabled={disabled}
          onChange={(event) => setParam({ pan: Number(event.target.value) })}
          className="flex-1"
        />
        <span className="w-12 text-right">{params.pan.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-20">Fade in</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={params.fadeInSec}
          disabled={disabled}
          onChange={(event) => setParam({ fadeInSec: Number(event.target.value) })}
          className="flex-1"
        />
        <span className="w-12 text-right">{params.fadeInSec.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-20">Fade out</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={params.fadeOutSec}
          disabled={disabled}
          onChange={(event) => setParam({ fadeOutSec: Number(event.target.value) })}
          className="flex-1"
        />
        <span className="w-12 text-right">{params.fadeOutSec.toFixed(1)}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={savesDisabled}
          onClick={onSaveLoop}
        >
          Save loop
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={savesDisabled}
          onClick={onSaveSoundboard}
        >
          Save as soundboard
        </button>
      </div>
    </div>
  );
}
