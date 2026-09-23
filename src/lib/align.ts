import type { Point } from '../types';

// How firmly to snap each blend back onto the reference: 1 = fully pinned, 0 = only flips removed.
const ALIGN_STRENGTH = 0.9;

/**
 * Rotate/reflect `coords` to (partly) match `reference` over shared ids (2-D orthogonal
 * Procrustes). UMAP leaves the map's orientation and handedness free, so consecutive blends
 * can come out spun or mirror-flipped. Flips are always cancelled; rotation is damped by
 * `strength`, leaving the rest as gentle drift. Translation/scale are left to fitToBox.
 */
export function alignToReference(
  coords: Record<string, Point>,
  reference: Record<string, Point>,
  strength = ALIGN_STRENGTH,
): Record<string, Point> {
  const ids = Object.keys(coords).filter((id) => reference[id]);
  if (ids.length < 3) return coords;

  let cx = 0;
  let cy = 0;
  let rx = 0;
  let ry = 0;
  for (const id of ids) {
    cx += coords[id].x;
    cy += coords[id].y;
    rx += reference[id].x;
    ry += reference[id].y;
  }
  const n = ids.length;
  cx /= n;
  cy /= n;
  rx /= n;
  ry /= n;

  // Cross-covariance A = Xcentered^T times Rcentered, stored as the scalars [a b; c d].
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const id of ids) {
    const ux = coords[id].x - cx;
    const uy = coords[id].y - cy;
    const vx = reference[id].x - rx;
    const vy = reference[id].y - ry;
    a += ux * vx;
    b += ux * vy;
    c += uy * vx;
    d += uy * vy;
  }

  // Best rotation vs best reflection (closed form in 2-D). Take whichever aligns more.
  // Rotation is undone partly (angle scaled by strength); reflection is undone fully.
  let m00: number;
  let m01: number;
  let m10: number;
  let m11: number;
  if (Math.hypot(a + d, c - b) >= Math.hypot(a - d, b + c)) {
    const t = Math.atan2(c - b, a + d) * strength;
    const cs = Math.cos(t);
    const sn = Math.sin(t);
    m00 = cs;
    m01 = -sn;
    m10 = sn;
    m11 = cs;
  } else {
    const p = Math.atan2(b + c, a - d);
    const cs = Math.cos(p);
    const sn = Math.sin(p);
    m00 = cs;
    m01 = sn;
    m10 = sn;
    m11 = -cs;
  }

  const out: Record<string, Point> = {};
  for (const id of Object.keys(coords)) {
    const ux = coords[id].x - cx;
    const uy = coords[id].y - cy;
    out[id] = { x: rx + (ux * m00 + uy * m10), y: ry + (ux * m01 + uy * m11) };
  }
  return out;
}
