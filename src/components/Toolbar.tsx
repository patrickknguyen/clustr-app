import { useRef } from 'react';
import { useStore } from '../store';

// The wordmark and the upload action. The board's name lives in BoardBar, where it's renamed.
export function Toolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const addFiles = useStore((s) => s.addFiles);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <img
        className="brand"
        src={`${import.meta.env.BASE_URL}clustr-wordmark.png`}
        alt="clustr"
        height="24"
      />

      <div className="toolbar-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif,image/heic,image/heif"
          multiple
          hidden
          onChange={onPick}
        />
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Add images
        </button>
      </div>
    </div>
  );
}
