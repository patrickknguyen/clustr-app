import { UMAP } from 'umap-js';
import { mulberry32 } from './rng';
import type { Point } from '../types';

// Project embeddings to a 2D map with UMAP. Returns raw coords so the view can rescale
// to any viewport without re-projecting, keeping positions stable on resize.
export function computeProjection(
  items: { id: string; embedding: Float32Array }[],
): Record<string, Point> {
  const n = items.length;
  const out: Record<string, Point> = {};
  if (n === 0) return out;
  if (n === 1) {
    out[items[0].id] = { x: 0, y: 0 };
    return out;
  }

  const vectors = items.map((i) => Array.from(i.embedding));
  const nNeighbors = Math.max(2, Math.min(15, n - 1));
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    random: mulberry32(42),
  });
  const coords = umap.fit(vectors);
  coords.forEach(([x, y], i) => {
    out[items[i].id] = { x, y };
  });
  return out;
}
