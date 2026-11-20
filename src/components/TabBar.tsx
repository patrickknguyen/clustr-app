import { motion } from 'motion/react';
import { useStore } from '../store';

export function TabBar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const showClusters = useStore((s) => s.showClusters);
  // "Mapping..." covers the whole upload, embed, and cluster process.
  const isBusy = useStore(
    (s) => s.isClustering || s.images.some((i) => i.status === 'pending'),
  );
  const readyCount = useStore(
    (s) => s.images.filter((i) => i.status === 'ready' && i.embedding).length,
  );
  const pendingCount = useStore((s) => s.images.filter((i) => i.status === 'pending').length);

  return (
    <div className="tabbar" role="tablist">
      <button
        role="tab"
        aria-selected={mode === 'grid'}
        className={`tab ${mode === 'grid' ? 'active' : ''}`}
        onClick={() => setMode('grid')}
      >
        Library
        {mode === 'grid' && <motion.span layoutId="tab-indicator" className="tab-indicator" />}
      </button>
      <button
        role="tab"
        aria-selected={mode === 'cluster'}
        className={`tab ${mode === 'cluster' ? 'active' : ''}`}
        disabled={readyCount < 2}
        onClick={() => showClusters()}
      >
        {pendingCount > 0
          ? `Mapping ${readyCount} of ${readyCount + pendingCount}…`
          : isBusy
            ? 'Mapping…'
            : 'Map'}
        {mode === 'cluster' && <motion.span layoutId="tab-indicator" className="tab-indicator" />}
      </button>
    </div>
  );
}
