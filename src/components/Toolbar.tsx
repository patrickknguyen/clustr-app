import { useRef } from 'react';
import { useStore } from '../store';

export function Toolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const images = useStore((s) => s.images);
  const addFiles = useStore((s) => s.addFiles);
  const clearAll = useStore((s) => s.clearAll);
  const boardName = useStore((s) => s.boardName);
  const setBoardName = useStore((s) => s.setBoardName);

  const total = images.length;
  const ready = images.filter((i) => i.status === 'ready').length;

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
        {total > 0 && (
          <span className="counter">
            {ready < total ? `embedding ${ready}/${total}` : `${total} ready`}
          </span>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPick}
        />
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Add images
        </button>
        {total > 0 && (
          <button className="btn ghost" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
