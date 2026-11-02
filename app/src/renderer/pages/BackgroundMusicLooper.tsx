import { useState } from "react";
import Waveform from "../components/Waveform";

/**
 * Background Music Looper page
 * This page allows the user to upload a background music file and loop it.
 * The user can also set the loop start and end times.
 * The user can also set the loop speed.
 * The user can also set the loop volume.
 * The user can also set the loop pitch.
 * The user can also set the loop pan.
 * The user can also set the loop fade in and fade out times.
 * The user can also set the loop fade in and fade out volume.
 * ! To be implemented:
 *  - System helps detect the ideal place to loop the background music. Using fourier transform to find the most repetitive pattern.
 * @returns Background Music Looper page
 */
export default function BackgroundMusicLooper() {
  const [backgroundMusicFile, setBackgroundMusicFile] = useState<File | null>(
    null
  );
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState<string | null>(
    null
  );
  const handleBackgroundMusicChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      setBackgroundMusicFile(file);
      setBackgroundMusicUrl(URL.createObjectURL(file));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1>Background Music Looper</h1>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium border-b w-fit">
            Background Music
          </h2>
          <input
            type="file"
            onChange={handleBackgroundMusicChange}
            className="border border-gray-300 rounded-md p-2 w-fit"
          />
        </div>

        {/* Waveform, easy and intuitive way to set the loop start and end times */}
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium border-b w-fit">Waveform</h2>
          {backgroundMusicUrl && <Waveform audioUrl={backgroundMusicUrl} />}
        </div>
      </div>
    </div>
  );
}
