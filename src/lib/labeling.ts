import { mulberry32 } from './rng';
import type { Cluster, ClusterTag, Point } from '../types';

const MAX_K = 7;
const QUALITY_THRESHOLD = 0.12; // min mean silhouette to accept discrete clusters
const TAG_MARGIN = 0.5; // cluster tags: keep a 2nd/3rd tag if >= this fraction of the top score
const BOARD_MARGIN = 0.95; // board theme: tighter — a 2nd word must be nearly as universal as #1
const TAG_TEMP = 1.0; // chip placement sharpness: lower snaps to top image, higher floats among matches
const SYNONYM_MAX_SIM = 0.9; // drop a tag whose text vector is this close to one already chosen
const BOARD_THRESHOLD = 0.15; // min "applies to every cluster" score for a board-level theme to exist
const MATCH_FLOOR = 0.90; // a tag must match the cluster at >= this fraction of its best match

interface Item {
  id: string;
  embedding: Float32Array;
  coord: Point;
}

type Vocab = { word: string; vec: Float32Array }[];

/**
 * Group images and tag each group. `k` is chosen by silhouette score, not a
 * fixed formula; if no split is well-separated enough, the whole board collapses
 * to a single descriptor rather than inventing regional labels. Tags come from
 * the semantic centroid of each group's CLIP embeddings, ranked by
 * distinctiveness (similarity minus the word's cross-cluster mean), and the
 * count is variable (1–3) so crisp groups get one word and mixed groups get more.
 *
 * Also returns `boardTags`: the theme shared by the *whole* board (see boardTheme).
 */
export function groupAndLabel(
  items: Item[],
  vocab: Vocab,
  maxTags = 3,
): { clusters: Cluster[]; boardTags: string[] } {
  const n = items.length;
  if (n === 0) return { clusters: [], boardTags: [] };
  const vocabMap = new Map(vocab.map((v) => [v.word, v.vec]));

  const coords = items.map((i) => i.coord);
  const dist = pairwise(coords);

  let best = { k: 1, score: -Infinity, assign: new Array<number>(n).fill(0) };
  const maxK = Math.min(MAX_K, n - 1);
  for (let k = 2; k <= maxK; k++) {
    const assign = kmeans(coords, k);
    const score = silhouette(assign, dist, k);
    if (score > best.score) best = { k, score, assign };
  }

  // No well-separated structure: one board-level descriptor.
  if (best.k < 2 || best.score < QUALITY_THRESHOLD) {
    const centroid = meanVector(items.map((i) => i.embedding));
    const boardTags = boardTheme([centroid], vocab, vocabMap, maxTags);
    const isBoardWord = boardExcluder(boardTags, vocabMap);
    const base = vocab.map((v) => ({ word: v.word, score: dot(centroid, v.vec) }));
    const scored = base.filter((x) => !isBoardWord(x.word));
    const words = pickTags(scored.length ? scored : base, vocabMap, maxTags, TAG_MARGIN);
    const clusters = [{ memberIds: items.map((i) => i.id), tags: placeTags(words, items, vocabMap) }];
    return { clusters, boardTags };
  }

  const groups: Item[][] = Array.from({ length: best.k }, () => []);
  best.assign.forEach((c, i) => groups[c].push(items[i]));
  const grouped = groups.filter((g) => g.length > 0);

  const centroids = grouped.map((g) => meanVector(g.map((m) => m.embedding)));
  const sims = centroids.map((c) => vocab.map((v) => dot(c, v.vec)));
  const wordMean = vocab.map((_, j) => sims.reduce((a, row) => a + row[j], 0) / sims.length);

  // Board theme first, so cluster tags can exclude it: a word that describes the
  // whole board (e.g. "summer") belongs on the board, not repeated on a cluster.
  // Distinctiveness alone demotes such words but doesn't guarantee their removal —
  // a universal word can still top the cluster where it happens to peak.
  const boardTags = boardTheme(centroids, vocab, vocabMap, maxTags);
  const isBoardWord = boardExcluder(boardTags, vocabMap);

  const clusters = grouped.map((members, ci) => {
    // Only consider words that actually match this cluster well (a floor relative
    // to its best match), THEN rank by distinctiveness. Without this, on a
    // homogeneous board distinctiveness surfaces words that match by chance
    // ("abyssinian") over accurate-but-common ones ("minimal", "home decor").
    const floor = Math.max(...sims[ci]) * MATCH_FLOOR;
    const base = vocab
      .map((v, j) => ({ word: v.word, score: sims[ci][j] - wordMean[j], raw: sims[ci][j] }))
      .filter((x) => x.raw >= floor);
    // Drop board-level words; fall back to the unfiltered set if that empties it,
    // so a cluster never ends up with no tag at all.
    const scored = base.filter((x) => !isBoardWord(x.word));
    const words = pickTags(scored.length ? scored : base, vocabMap, maxTags, TAG_MARGIN);
    return { memberIds: members.map((m) => m.id), tags: placeTags(words, members, vocabMap) };
  });

  return { clusters, boardTags };
}

/**
 * The theme shared by the whole board: words scored by their *minimum* similarity
 * across cluster centroids — i.e. how well a word applies to EVERY cluster. This
 * promotes a truly universal word ("summer") and demotes sub-theme words
 * ("beach", "sand") that only fit one cluster, so the theme never becomes a
 * redundant pile. If nothing clears BOARD_THRESHOLD, the board has no shared
 * theme and we return nothing (rather than a meaningless word).
 */
function boardTheme(
  centroids: Float32Array[],
  vocab: Vocab,
  vocabMap: Map<string, Float32Array>,
  maxTags: number,
): string[] {
  if (centroids.length === 0) return [];
  const scored = vocab.map((v) => {
    let min = Infinity;
    for (const c of centroids) min = Math.min(min, dot(c, v.vec));
    return { word: v.word, score: min };
  });
  const topScore = Math.max(...scored.map((s) => s.score));
  if (!Number.isFinite(topScore) || topScore < BOARD_THRESHOLD) return [];
  return pickTags(scored, vocabMap, maxTags, BOARD_MARGIN);
}

/**
 * Predicate for words to keep off cluster tags: the board-theme words themselves
 * plus any near-synonym of one (so "summer" excludes "summertime" too), reusing
 * the same similarity cutoff pickTags uses to dedupe synonyms.
 */
function boardExcluder(
  boardTags: string[],
  vocabMap: Map<string, Float32Array>,
): (word: string) => boolean {
  const set = new Set(boardTags);
  const vecs = boardTags
    .map((w) => vocabMap.get(w))
    .filter((v): v is Float32Array => v !== undefined);
  return (word) => {
    if (set.has(word)) return true;
    const wv = vocabMap.get(word);
    if (!wv) return false;
    return vecs.some((bv) => dot(wv, bv) > SYNONYM_MAX_SIM);
  };
}

/**
 * Top-1 always, then further tags while they stay near the top score — skipping
 * any candidate whose text vector is a near-synonym of one already chosen, so
 * labels read "ocean · beach · swimming" rather than the redundant "ocean · sea".
 */
function pickTags(
  scored: { word: string; score: number }[],
  vocabMap: Map<string, Float32Array>,
  maxTags: number,
  margin: number,
): string[] {
  const ranked = scored.slice().sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];
  const top = ranked[0].score;
  const tags = [ranked[0].word];
  for (let i = 1; i < ranked.length && tags.length < maxTags; i++) {
    const cand = ranked[i];
    if (!(cand.score > 0 && cand.score >= top * margin)) break;
    const cv = vocabMap.get(cand.word);
    const synonym = cv && tags.some((w) => {
      const pv = vocabMap.get(w);
      return pv ? dot(cv, pv) > SYNONYM_MAX_SIM : false;
    });
    if (!synonym) tags.push(cand.word);
  }
  return tags;
}

/**
 * Weight each cluster member by how well it matches the tag, so the chip can sit
 * at the weighted centroid of the images it describes. Similarities are z-scored
 * before softmax because CLIP's cross-modal cosines sit in a narrow band —
 * without that, weights are near-uniform and every chip collapses to the center.
 */
function placeTags(words: string[], members: Item[], vocabMap: Map<string, Float32Array>): ClusterTag[] {
  return words.map((word) => {
    const vec = vocabMap.get(word);
    const sims = members.map((m) => (vec ? dot(m.embedding, vec) : 0));
    const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
    let variance = 0;
    for (const s of sims) variance += (s - mean) ** 2;
    const std = Math.sqrt(variance / sims.length) || 1;

    const exps = sims.map((s) => Math.exp((s - mean) / std / TAG_TEMP));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const weights = members.map((m, i) => ({ id: m.id, w: exps[i] / sum }));
    return { word, weights };
  });
}

/** Seeded k-means (k-means++ init) over 2D points; returns a cluster index each. */
function kmeans(points: Point[], k: number): number[] {
  const n = points.length;
  if (n <= k) return points.map((_, i) => i);
  const rand = mulberry32(7);

  const centers: Point[] = [{ ...points[Math.floor(rand() * n)] }];
  while (centers.length < k) {
    const d2 = points.map((p) => {
      let best = Infinity;
      for (const c of centers) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        best = Math.min(best, dx * dx + dy * dy);
      }
      return best;
    });
    const sum = d2.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * sum;
    let idx = 0;
    while (idx < n - 1 && (r -= d2[idx]) > 0) idx++;
    centers.push({ ...points[idx] });
  }

  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = points[i].x - centers[c].x;
        const dy = points[i].y - centers[c].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sx = new Array(k).fill(0);
    const sy = new Array(k).fill(0);
    const cnt = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      sx[assign[i]] += points[i].x;
      sy[assign[i]] += points[i].y;
      cnt[assign[i]]++;
    }
    for (let c = 0; c < k; c++) {
      if (cnt[c] > 0) centers[c] = { x: sx[c] / cnt[c], y: sy[c] / cnt[c] };
    }
    if (!changed) break;
  }
  return assign;
}

/** Mean silhouette score of an assignment; measures how well-separated clusters are. */
function silhouette(assign: number[], dist: Float64Array, k: number): number {
  const n = assign.length;
  const members: number[][] = Array.from({ length: k }, () => []);
  assign.forEach((c, i) => members[c].push(i));

  let total = 0;
  for (let i = 0; i < n; i++) {
    const ci = assign[i];
    if (members[ci].length <= 1) continue;
    let a = 0;
    for (const j of members[ci]) if (j !== i) a += dist[i * n + j];
    a /= members[ci].length - 1;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ci || members[c].length === 0) continue;
      let m = 0;
      for (const j of members[c]) m += dist[i * n + j];
      m /= members[c].length;
      if (m < b) b = m;
    }
    if (b !== Infinity) total += (b - a) / Math.max(a, b);
  }
  return n ? total / n : -Infinity;
}

function pairwise(pts: Point[]): Float64Array {
  const n = pts.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      d[i * n + j] = v;
      d[j * n + i] = v;
    }
  }
  return d;
}

function meanVector(vecs: Float32Array[]): Float32Array {
  const dim = vecs[0].length;
  const out = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += out[i] * out[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
