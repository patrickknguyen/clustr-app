import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../store';
import { useElementSize } from '../hooks/useElementSize';
import { fitToBox } from '../lib/layout';

const CELL = 150; // base element size (px) — ~8 images per row in the library
const GAP = 12;
const PAD = 16;
const CLUSTER_SCALE = 0.5; // cluster thumbs are smaller (CELL*0.4 ≈ the old 72px)
const CHIP_MIN_DIST = 48; // min gap between a cluster's tag chips (px)

/**
 * Push a cluster's tag chips apart so tags that describe the same images (and
 * thus land on the same weighted centroid) don't stack on top of each other.
 */
function spreadChips(chips: { word: string; x: number; y: number }[]) {
  if (chips.length < 2) return chips;
  // Tiny deterministic jitter gives coincident chips a direction to separate in.
  chips.forEach((c, i) => {
    c.x += Math.cos(i * 2.399) * 0.6;
    c.y += Math.sin(i * 2.399) * 0.6;
  });
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const dx = chips[j].x - chips[i].x;
        const dy = chips[j].y - chips[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < CHIP_MIN_DIST) {
          const push = (CHIP_MIN_DIST - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          chips[i].x -= ux * push;
          chips[i].y -= uy * push;
          chips[j].x += ux * push;
          chips[j].y += uy * push;
        }
      }
    }
  }
  return chips;
}

export function Stage() {
  const images = useStore((s) => s.images);
  const projection = useStore((s) => s.projection);
  const clusters = useStore((s) => s.clusters);
  const boardTags = useStore((s) => s.boardTags);
  const mode = useStore((s) => s.mode);
  const removeImage = useStore((s) => s.removeImage);
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const isCluster = mode === 'cluster';
  const cols = Math.max(1, Math.floor((size.width - PAD * 2 + GAP) / (CELL + GAP)));

  // Grid slot (top-left) per image, plus total scroll height.
  const grid = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    images.forEach((img, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      pos[img.id] = { x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP) };
    });
    const rows = Math.ceil(images.length / cols) || 1;
    return { pos, height: PAD * 2 + rows * (CELL + GAP) - GAP };
  }, [images, cols]);

  // Cluster centers via UMAP -> viewport mapping.
  const clusterPos = useMemo(
    () =>
      fitToBox(
        projection,
        images.filter((i) => projection[i.id]).map((i) => i.id),
        size.width,
        size.height,
        CELL * CLUSTER_SCALE,
        PAD + CELL * CLUSTER_SCALE,
      ),
    [projection, images, size.width, size.height],
  );

  // Per cluster: centroid (collapsed label position) + each tag's anchor position.
  const labels = useMemo(() => {
    if (!isCluster) return [];
    return clusters
      .map((cl, ci) => {
        const pts = cl.memberIds.map((id) => clusterPos[id]).filter(Boolean);
        if (pts.length === 0) return null;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const chips = spreadChips(
          cl.tags.map((t) => {
            let x = 0;
            let y = 0;
            let wsum = 0;
            for (const { id, w } of t.weights) {
              const p = clusterPos[id];
              if (!p) continue;
              x += p.x * w;
              y += p.y * w;
              wsum += w;
            }
            return { word: t.word, x: wsum ? x / wsum : cx, y: wsum ? y / wsum : cy };
          }),
        );
        return { ci, cx, cy, words: cl.tags.map((t) => t.word), chips };
      })
      .filter((l) => l !== null);
  }, [isCluster, clusters, clusterPos]);

  const dimSet =
    isCluster && hovered !== null && clusters[hovered]
      ? new Set(clusters[hovered].memberIds)
      : null;

  // Board-level theme: a faint word at the map's center of mass (only when there
  // are multiple clusters — with one cluster its own label already says it).
  const boardTheme = useMemo(() => {
    if (!isCluster || boardTags.length === 0 || clusters.length < 2) return null;
    const pts = Object.values(clusterPos);
    if (pts.length === 0) return null;
    const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    return { text: boardTags.join(' · '), x, y };
  }, [isCluster, boardTags, clusters.length, clusterPos]);

  if (images.length === 0) {
    return (
      <div className="stage-scroll fit" ref={ref}>
        <div className="empty">
          Drop images here, or use “Add images”. Then open the “Map”.
        </div>
      </div>
    );
  }

  return (
    <div className={`stage-scroll ${isCluster ? 'fit' : 'scroll'}`} ref={ref}>
      <div
        className="stage-inner"
        style={{ height: isCluster ? '100%' : grid.height }}
      >
        {boardTheme && (
          <motion.div
            className="board-theme"
            style={{ left: boardTheme.x, top: boardTheme.y }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.2 }}
          >
            {boardTheme.text}
          </motion.div>
        )}

        {images.map((img) => {
          const cp = clusterPos[img.id];
          const showCluster = isCluster && cp;
          const g = grid.pos[img.id];
          const x = showCluster ? cp.x - CELL / 2 : g.x;
          const y = showCluster ? cp.y - CELL / 2 : g.y;
          const scale = showCluster ? CLUSTER_SCALE : 1;
          const opacity =
            isCluster && !cp ? 0 : dimSet && !dimSet.has(img.id) ? 0.12 : 1;

          return (
            <motion.div
              key={img.id}
              className="thumb"
              style={{ width: CELL, height: CELL }}
              initial={false}
              animate={{ x, y, scale, opacity }}
              transition={
                // Animate the grid↔map morph and the in-map reflow; but in the grid,
                // reposition instantly so resizing the window doesn't slide the images.
                isCluster
                  ? { duration: 0.9, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.2 } }
                  : { duration: 0, opacity: { duration: 0.2 } }
              }
            >
              <img src={img.url} alt="" draggable={false} />
              {!isCluster && (
                <button
                  className="thumb-x"
                  onClick={() => removeImage(img.id)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </motion.div>
          );
        })}

        {labels.map((l) => (
          <motion.div
            key={`label-${l.ci}`}
            className="label-anchor"
            style={{ left: l.cx, top: l.cy }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.2 }}
            onMouseEnter={() => setHovered(l.ci)}
            onMouseLeave={() => setHovered((h) => (h === l.ci ? null : h))}
          >
            <motion.div
              className="cluster-label"
              initial={false}
              animate={{
                opacity: hovered === null ? 1 : hovered === l.ci ? 0 : 0.25,
              }}
              transition={{ duration: 0.15 }}
            >
              {l.words.join(' | ')}
            </motion.div>
          </motion.div>
        ))}

        {labels.flatMap((l) =>
          l.chips.map((c, k) => (
            <motion.div
              key={`chip-${l.ci}-${k}`}
              className="tag-chip"
              initial={false}
              animate={
                hovered === l.ci
                  ? { left: c.x, top: c.y, opacity: 1 }
                  : { left: l.cx, top: l.cy, opacity: 0 }
              }
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            >
              {c.word}
            </motion.div>
          )),
        )}
      </div>
    </div>
  );
}
