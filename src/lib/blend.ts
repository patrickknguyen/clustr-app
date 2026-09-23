// Blend CLIP (semantic) and DINOv2 (visual) into one vector per image, controlled by alpha.
// alpha 0 is pure CLIP, alpha 1 is pure DINO (grouping by look).

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

// Per-board scale that makes DINO's distance spread match CLIP's, so the slider feels even.
export function dinoScale(clip: Float32Array[], dino: Float32Array[]): number {
  return distSpread(clip) / distSpread(dino);
}

/**
 * One blended vector per image: [ sqrt(1-a)*clip , sqrt(a)*scale*dino ], where a is alpha.
 * The squared distance between two of these works out to (1-a)*clipDist^2 + a*(scale*dinoDist)^2,
 * so alpha interpolates linearly between the two spaces. This feeds UMAP and clustering; the
 * labels still read the raw CLIP vector.
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
