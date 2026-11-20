import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { useStore } from './store';
import { embedder } from './lib/embedder';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { SampleBar } from './components/SampleBar';
import { BoardBar } from './components/BoardBar';
import { BlendSlider } from './components/BlendSlider';
import { Stage } from './components/Stage';
import { GalleryMode } from './components/GalleryMode';
import { GALLERY } from './lib/gallery';
import './App.css';

export default function App() {
  const addFiles = useStore((s) => s.addFiles);
  const initSamples = useStore((s) => s.initSamples);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    initSamples();
    // Load the models during idle time so the first upload doesn't wait on them.
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(() => embedder.warm(), { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => embedder.warm(), 3000);
    return () => window.clearTimeout(id);
  }, [initSamples]);

  return (
    // Honor the system's reduce-motion setting for every Motion animation.
    <MotionConfig reducedMotion="user">
      <div
        className={`app ${GALLERY ? 'gallery' : ''} ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
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
            {!GALLERY && <SampleBar />}
          </div>
        </header>

        <main className="stage">
          <BlendSlider />
          <Stage />
        </main>

        {GALLERY && <GalleryMode />}
        {dragging && <div className="drop-overlay">Drop to add</div>}
      </div>
    </MotionConfig>
  );
}
