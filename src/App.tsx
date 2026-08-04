import { useEffect, useState } from 'react';
import { useStore } from './store';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { SampleBar } from './components/SampleBar';
import { Stage } from './components/Stage';
import './App.css';

export default function App() {
  const addFiles = useStore((s) => s.addFiles);
  const initSamples = useStore((s) => s.initSamples);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    initSamples();
  }, [initSamples]);

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
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
          <SampleBar />
        </div>
      </header>

      <main className="stage">
        <Stage />
      </main>

      {dragging && <div className="drop-overlay">Drop to add</div>}
    </div>
  );
}
