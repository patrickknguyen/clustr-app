import type { Point } from '../types';

/**
 * Pure mapping of raw projection coordinates into a pixel box, preserving
 * aspect ratio and centering, then a light collision-relaxation pass so
 * near-identical images fan out instead of stacking. Deterministic given the
 * same inputs, so resizing just rescales.
 * Returned points are thumbnail *centers*.
 */
export function fitToBox(
  projection: Record<string, Point>,
  ids: string[],
  width: number,
  height: number,
  thumb = 76,
  padding = 90,
): Record<string, Point> {
  const present = ids.filter((id) => projection[id]);
  if (present.length === 0 || width === 0 || height === 0) return {};

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of present) {
    const { x, y } = projection[id];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const availW = Math.max(1, width - padding * 2);
  const availH = Math.max(1, height - padding * 2);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min(availW / spanX, availH / spanY);

  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const offX = padding + (availW - usedW) / 2;
  const offY = padding + (availH - usedH) / 2;

  // Mutable working set for relaxation.
  const nodes = present.map((id) => ({
    id,
    x: offX + (projection[id].x - minX) * scale,
    y: offY + (projection[id].y - minY) * scale,
  }));

  relax(nodes, thumb * 0.92, width, height, padding);

  const out: Record<string, Point> = {};
  for (const n of nodes) out[n.id] = { x: n.x, y: n.y };
  return out;
}

/**
 * Simple O(n²) repulsion: pairs closer than minDist are pushed apart. Keeps the
 * cluster shape but stops thumbnails from perfectly overlapping. Cheap at the
 * scale we target (<= a few hundred nodes).
 */
function relax(
  nodes: { id: string; x: number; y: number }[],
  minDist: number,
  width: number,
  height: number,
  padding: number,
  iterations = 60,
) {
  const half = minDist;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d === 0) {
          // Perfectly coincident: nudge apart deterministically.
          dx = Math.cos(i * 2.4);
          dy = Math.sin(i * 2.4);
          d = 1;
        }
        if (d < minDist) {
          const push = (minDist - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
    // Keep everything inside the padded viewport.
    for (const n of nodes) {
      n.x = Math.max(padding + half / 2, Math.min(width - padding - half / 2, n.x));
      n.y = Math.max(padding + half / 2, Math.min(height - padding - half / 2, n.y));
    }
  }
}
