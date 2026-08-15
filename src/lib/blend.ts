// Blend the two image spaces — CLIP (semantic) and DINOv2 (visual) — into one
// vector per image, controlled by alpha. alpha=0 → pure CLIP (semantic grouping,
// the original behaviour); alpha=1 → pure DINO (grouping by look).

function eucd(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function distSpread(vecs: Float32Array[]): number {
  const ds: number[] = [];
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) ds.push(eucd(vecs[i], vecs[j]));
  if (ds.length === 0) return 1;
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length) || 1;
}

/**
 * Per-board scale that makes DINO's pairwise-distance spread match CLIP's. Without
 * it the two spaces are on different rulers and the slider feels non-linear (one
 * space dominates well before the midpoint). Computed from the board's own vectors,
 * so every board stays balanced regardless of how its two spaces happen to spread.
 */
export function dinoScale(clip: Float32Array[], dino: Float32Array[]): number {
  return distSpread(clip) / distSpread(dino);
}

/**
 * One blended vector per image: `[ √(1−α)·clip , √α·scale·dino ]`. Euclidean distance
 * on the concatenation equals `(1−α)·clipDist² + α·(scale·dinoDist)²`, so α linearly
 * interpolates the grouping between the two spaces. Feeds UMAP + clustering; labels
 * still read the raw CLIP vector (DINO has no text tower).
 */
export function blendVectors(
  items: { id: string; clip: Float32Array; dino: Float32Array }[],
  alpha: number,
  scale: number,
): { id: string; embedding: Float32Array }[] {
  const wc = Math.sqrt(1 - alpha);
  const wd = Math.sqrt(alpha) * scale;
  return items.map(({ id, clip, dino }) => {
    const out = new Float32Array(clip.length + dino.length);
    for (let k = 0; k < clip.length; k++) out[k] = clip[k] * wc;
    for (let k = 0; k < dino.length; k++) out[clip.length + k] = dino[k] * wd;
    return { id, embedding: out };
  });
}
