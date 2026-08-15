import type { Point } from '../types';

/**
 * How firmly to snap each blend back onto the reference frame. 1 = fully pinned (only
 * genuine reshuffling moves, can feel static); 0 = mirror-flips removed but all of
 * UMAP's rotation kept (most motion). Mirror-flips (the jarring "pole inversion") are
 * ALWAYS removed regardless — only the rotation component is damped by this factor.
 */
const ALIGN_STRENGTH = 0.9;

/**
 * Rotate/reflect `coords` to (partly) match `reference` over their shared ids (2-D
 * orthogonal Procrustes). UMAP fixes local neighbourhoods but leaves the map's global
 * orientation and handedness free, so consecutive blends can come out spun or
 * mirror-flipped even when the structure barely changed — the poles "invert", the map
 * re-centres. We always cancel the handedness flip, and cancel ALIGN_STRENGTH of the
 * rotation, leaving the rest as gentle drift. Translation and scale are ignored on
 * purpose — fitToBox re-centres and re-scales downstream.
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

  // Cross-covariance A = Xcentred^T · Rcentred, as scalars [a b; c d].
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

  // Best pure rotation vs best reflection (closed form in 2-D); take whichever aligns
  // more. A rotation we only PARTLY undo (scale the angle by `strength`) so a gentle
  // spin survives. A reflection we undo FULLY — a half-applied flip just turns into a
  // rotation that looks equally inverted, so partial reflection is meaningless; the
  // jarring pole-inversion is always cancelled outright.
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
