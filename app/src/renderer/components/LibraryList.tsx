import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "../../library/types";

type LibraryListProps = {
  items: LibraryItem[];
  error: string | null;
  onPlay: (item: LibraryItem) => void;
  onLoad: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  onRename: (item: LibraryItem, name: string) => void | Promise<void>;
};

const buttonClass = "border border-gray-300 rounded-md px-2 py-1";

function LibraryRow({
  item,
  onPlay,
  onLoad,
  onDelete,
  onRename,
}: {
  item: LibraryItem;
  onPlay: (item: LibraryItem) => void;
  onLoad: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  onRename: (item: LibraryItem, name: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(item.name);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    setDraft(item.name);
  }, [item.name]);

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    if (draft === item.name) return;
    const nextName = draft;
    void Promise.resolve(onRename(item, nextName)).catch(() => {
      setDraft(item.name);
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={draft}
        aria-label={`Name for ${item.name}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            skipCommitRef.current = true;
            setDraft(item.name);
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="border border-gray-300 rounded-md p-1 flex-1 min-w-0"
      />
      <button type="button" className={buttonClass} onClick={() => onPlay(item)}>
        Play
      </button>
      <button type="button" className={buttonClass} onClick={() => onLoad(item)}>
        Load
      </button>
      <button type="button" className={buttonClass} onClick={() => onDelete(item)}>
        Delete
      </button>
    </li>
  );
}

function Group({
  title,
  items,
  onPlay,
  onLoad,
  onDelete,
  onRename,
}: {
  title: string;
  items: LibraryItem[];
} & Omit<LibraryListProps, "items" | "error">) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium border-b w-fit">{title}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <LibraryRow
            key={item.id}
            item={item}
            onPlay={onPlay}
            onLoad={onLoad}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </ul>
    </div>
  );
}

export default function LibraryList({
  items,
  error,
  onPlay,
  onLoad,
  onDelete,
  onRename,
}: LibraryListProps) {
  const loops = items.filter((item) => item.type === "bgm");
  const soundboard = items.filter((item) => item.type === "soundboard");

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Group
        title="Loops"
        items={loops}
        onPlay={onPlay}
        onLoad={onLoad}
        onDelete={onDelete}
        onRename={onRename}
      />
      <Group
        title="Soundboard"
        items={soundboard}
        onPlay={onPlay}
        onLoad={onLoad}
        onDelete={onDelete}
        onRename={onRename}
      />
    </div>
  );
}
