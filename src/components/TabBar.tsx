import { useStore } from '../store';

export function TabBar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const showClusters = useStore((s) => s.showClusters);
  // "Mapping…" spans the whole upload → embed → cluster process.
  const isBusy = useStore(
    (s) => s.isClustering || s.images.some((i) => i.status === 'pending'),
  );
  const readyCount = useStore(
    (s) => s.images.filter((i) => i.status === 'ready' && i.embedding).length,
  );

  return (
    <div className="tabbar" role="tablist">
      <button
        role="tab"
        aria-selected={mode === 'grid'}
        className={`tab ${mode === 'grid' ? 'active' : ''}`}
        onClick={() => setMode('grid')}
      >
        Library
      </button>
      <button
        role="tab"
        aria-selected={mode === 'cluster'}
        className={`tab ${mode === 'cluster' ? 'active' : ''}`}
        disabled={readyCount < 2}
        onClick={() => showClusters()}
      >
        {isBusy ? 'Mapping…' : 'Map'}
      </button>
    </div>
  );
}
