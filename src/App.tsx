import { useEffect, useState } from 'react';
import { useStore } from './store';
import { embedder } from './lib/embedder';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { SampleBar } from './components/SampleBar';
import { BoardBar } from './components/BoardBar';
import { BlendSlider } from './components/BlendSlider';
import { Stage } from './components/Stage';
import './App.css';

export default function App() {
  const addFiles = useStore((s) => s.addFiles);
  const initSamples = useStore((s) => s.initSamples);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    initSamples();
    // Low-priority prefetch of the embedding models during idle time, so the first
    // upload is instant. Skip on data-saver / slow connections — a courtesy so we don't
    // silently pull a model onto a metered device for a visitor who's only browsing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = (navigator as any).connection;
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => embedder.warm(), { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => embedder.warm(), 3000);
    return () => window.clearTimeout(id);
  }, [initSamples]);

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
        embedder.warm(); // a file is inbound — start loading the model now
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="header">
        <Toolbar />
        <div className="subbar">
          <TabBar />
          <BoardBar />
          <SampleBar />
        </div>
      </header>

      <main className="stage">
        <BlendSlider />
        <Stage />
      </main>

      {dragging && <div className="drop-overlay">Drop to add</div>}
    </div>
  );
}
