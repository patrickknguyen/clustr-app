import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { GALLERY } from '../lib/gallery';
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
  const [local, setLocalState] = useState(alpha);
  // The thumb's current value, readable inside the animation without re-running it.
  const localRef = useRef(alpha);
  const setLocal = (v: number) => {
    localRef.current = v;
    setLocalState(v);
  };

  // When something else sets alpha, like the gallery's attract loop, glide the thumb there
  // on the same curve and timing as the images regrouping, instead of snapping. After a
  // drag the thumb is already at alpha, so nothing moves.
  useEffect(() => {
    if (localRef.current === alpha) return;
    const controls = animate(localRef.current, alpha, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        localRef.current = v;
        setLocalState(v);
      },
    });
    return () => controls.stop();
  }, [alpha]);

  if (!isCluster || !hasDino) return null;

  return (
    <div className="blend">
      <span className="blend-end">
        {GALLERY ? 'subject' : 'semantic'}
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
          style={{ '--fill': `${local * 100}%` } as React.CSSProperties}
        />
      </div>
      <span className="blend-end blend-end-right">
        {GALLERY ? 'look' : 'aesthetic'}
        <span className="blend-tip">uses DINO to group images with similar visual structure</span>
      </span>
      <span className="blend-value" aria-hidden="true">
        {local.toFixed(2)}
      </span>
    </div>
  );
}
