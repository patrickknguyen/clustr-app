import { useState } from 'react';
import { useStore } from '../store';
import { RAW } from '../lib/raw';

// Semantic to aesthetic blend slider, shown on the Map view only. It moves freely while
// dragging and commits on release. Hidden until every ready image has a DINO vector.
export function BlendSlider() {
  const alpha = useStore((s) => s.alpha);
  const setAlpha = useStore((s) => s.setAlpha);
  const isCluster = useStore((s) => s.mode === 'cluster');
  const hasDino = useStore((s) => {
    const ready = s.images.filter((i) => i.status === 'ready' && i.embedding);
    return ready.length >= 2 && ready.every((i) => i.dinoEmbedding);
  });
  const [local, setLocal] = useState(alpha);

  if (!isCluster || !hasDino) return null;

  return (
    <div className="blend">
      <span className="blend-end">
        semantic
        <span className="blend-tip">uses CLIP to group images by identifying objects</span>
      </span>
      <div className="blend-track">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={local}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal(v);
            if (RAW) setAlpha(v);
          }}
          onPointerUp={(e) => setAlpha(Number(e.currentTarget.value))}
          onKeyUp={(e) => setAlpha(Number(e.currentTarget.value))}
          aria-label="Blend semantic to aesthetic grouping"
        />
        <span className="blend-value" style={{ left: `${local * 100}%` }}>
          {local.toFixed(2)}
        </span>
      </div>
      <span className="blend-end blend-end-right">
        aesthetic
        <span className="blend-tip">uses DINO to group images with similar visual structure</span>
      </span>
    </div>
  );
}
