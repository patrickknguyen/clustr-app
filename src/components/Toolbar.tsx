import { useRef } from 'react';
import { useStore } from '../store';
import { embedder } from '../lib/embedder';

export function Toolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = useStore((s) => s.addFiles);
  const boardName = useStore((s) => s.boardName);
  const setBoardName = useStore((s) => s.setBoardName);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <div className="brand-group">
        <img
          className="brand"
          src={`${import.meta.env.BASE_URL}clustr-wordmark.png`}
          alt="clustr"
          height="24"
        />
        <input
          className="board-name"
          type="text"
          value={boardName}
          placeholder="Untitled board"
          aria-label="Board name"
          onChange={(e) => setBoardName(e.target.value)}
        />
      </div>

      <div className="toolbar-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPick}
        />
        <button
          className="btn"
          onMouseEnter={() => embedder.warm()} // likely about to upload — preload the model
          onClick={() => inputRef.current?.click()}
        >
          Add images
        </button>
      </div>
    </div>
  );
}
