import { mulberry32 } from './rng';
import type { Cluster, ClusterTag, Point } from '../types';

const MAX_K = 7;
const QUALITY_THRESHOLD = 0.12; // min mean silhouette to accept discrete clusters
const TAG_MARGIN = 0.5; // keep a 2nd/3rd cluster tag if it scores at least this fraction of the top
const BOARD_MARGIN = 0.97; // tighter margin for board-theme words
const TAG_TEMP = 1.0; // chip placement sharpness
const SYNONYM_MAX_SIM = 0.9; // drop a tag whose text vector is this close to one already chosen
const BOARD_THRESHOLD = 0.15; // min whole-board centroid cosine for a board-level theme to exist
const MATCH_FLOOR = 0.90; // a tag must match the cluster at least this fraction of its best match
const TRIM_FRACTION = 0.25; // robust centroid: share of farthest members dropped before re-averaging

interface Item {
  id: string;
  embedding: Float32Array;
  coord: Point;
}

type Vocab = { word: string; vec: Float32Array }[];

// Words above the cluster's match floor, scored by distinctiveness: sim minus the word's cross-cluster mean.
function scoreVocab(
  sims: number[],
  wordMean: number[],
  vocab: Vocab,
): { word: string; score: number; raw: number }[] {
  if (vocab.length === 0) return [];
  const floor = Math.max(...sims) * MATCH_FLOOR;
  return vocab
    .map((v, j) => ({ word: v.word, score: sims[j] - wordMean[j], raw: sims[j] }))
    .filter((x) => x.raw >= floor);
}

/**
 * Group the images and tag each group. k is picked by silhouette score. If no split is
 * clean enough, the whole board collapses to a single descriptor. Tags come from each
 * group's CLIP centroid, ranked by distinctiveness. As alpha rises the candidate words
 * shift from the subject vocab (alpha 0) toward the style vocab (alpha 1). Labels always
 * read CLIP, even when the layout was clustered on the DINO blend. boardTags are kept off
 * the cluster tags and returned unchanged.
 */
export function groupAndLabel(
  items: Item[],
  vocab: Vocab,
  style: Vocab = [],
  alpha = 0,
  boardTags: string[] = [],
  maxTags = 3,
): { clusters: Cluster[]; boardTags: string[] } {
  const n = items.length;
  if (n === 0) return { clusters: [], boardTags: [] };
  const vocabMap = new Map([...vocab, ...style].map((v) => [v.word, v.vec]));
  const blend = (
    nouns: { word: string; score: number }[],
    styles: { word: string; score: number }[],
  ) => [
    ...nouns.map((x) => ({ word: x.word, score: x.score * (1 - alpha) })),
    ...styles.map((x) => ({ word: x.word, score: x.score * alpha })),
  ];

  const coords = items.map((i) => i.coord);
  const dist = pairwise(coords);

  let best = { k: 1, score: -Infinity, assign: new Array<number>(n).fill(0) };
  const maxK = Math.min(MAX_K, n - 1);
  for (let k = 2; k <= maxK; k++) {
    const assign = kmeans(coords, k);
    const score = silhouette(assign, dist, k);
    if (score > best.score) best = { k, score, assign };
  }

  // No clean split, so describe the whole board with one set of tags.
  if (best.k < 2 || best.score < QUALITY_THRESHOLD) {
    const centroid = robustCentroid(items.map((i) => i.embedding));
    const isBoardWord = boardExcluder(boardTags, vocabMap);
    const nouns = vocab.map((v) => ({ word: v.word, score: dot(centroid, v.vec) }));
    const styles = style.map((v) => ({ word: v.word, score: dot(centroid, v.vec) }));
    const cands = blend(
      nouns.filter((x) => !isBoardWord(x.word)),
      styles.filter((x) => !isBoardWord(x.word)),
    );
    const words = pickTags(cands.length ? cands : blend(nouns, styles), vocabMap, maxTags, TAG_MARGIN);
    const clusters = [{ memberIds: items.map((i) => i.id), tags: placeTags(words, items, vocabMap) }];
    return { clusters, boardTags };
  }

  const groups: Item[][] = Array.from({ length: best.k }, () => []);
  best.assign.forEach((c, i) => groups[c].push(items[i]));
  const grouped = groups.filter((g) => g.length > 0);

  const centroids = grouped.map((g) => robustCentroid(g.map((m) => m.embedding)));
  const sims = centroids.map((c) => vocab.map((v) => dot(c, v.vec)));
  const wordMean = vocab.map((_, j) => sims.reduce((a, row) => a + row[j], 0) / sims.length);
  const styleSims = centroids.map((c) => style.map((v) => dot(c, v.vec)));
  const styleMean = style.map((_, j) => styleSims.reduce((a, row) => a + row[j], 0) / (styleSims.length || 1));

  // A word that describes the whole board belongs on the board, not on any one cluster.
  const isBoardWord = boardExcluder(boardTags, vocabMap);

  const clusters = grouped.map((members, ci) => {
    // Score each vocab on its own, blend by alpha, drop board words. Fall back so a cluster is never tagless.
    const nounEligible = scoreVocab(sims[ci], wordMean, vocab);
    const styleEligible = scoreVocab(styleSims[ci], styleMean, style);
    const cands = blend(
      nounEligible.filter((x) => !isBoardWord(x.word)),
      styleEligible.filter((x) => !isBoardWord(x.word)),
    );
    const words = pickTags(
      cands.length ? cands : blend(nounEligible, styleEligible),
      vocabMap,
      maxTags,
      TAG_MARGIN,
    );
    return { memberIds: members.map((m) => m.id), tags: placeTags(words, members, vocabMap) };
  });

  return { clusters, boardTags };
}

/**
 * The board's fixed identity: one label picked once per image set, independent of alpha.
 * Both vocabs are scored against the whole-board robust centroid (CLIP). The winning side is
 * whichever has the more distinctive top word (furthest above its own vocab's average) rather
 * than the higher raw cosine, so the large subject list can't beat the small curated style
 * list on size alone. Returns nothing if even the best word barely matches, meaning its raw
 * cosine is below BOARD_THRESHOLD.
 */
export function boardIdentity(
  embeddings: Float32Array[],
  vocab: Vocab,
  style: Vocab = [],
  maxTags = 3,
): string[] {
  if (embeddings.length === 0) return [];
  const centroid = robustCentroid(embeddings);
  const vocabMap = new Map([...vocab, ...style].map((v) => [v.word, v.vec]));

  const distinct = (v: Vocab) => {
    const raw = v.map((w) => ({ word: w.word, raw: dot(centroid, w.vec) }));
    const mean = raw.reduce((a, s) => a + s.raw, 0) / (raw.length || 1);
    return raw.map((s) => ({ word: s.word, score: s.raw - mean, raw: s.raw }));
  };
  const nouns = distinct(vocab);
  const styles = distinct(style);
  const top = (arr: { score: number }[]) => arr.reduce((m, x) => Math.max(m, x.score), -Infinity);

  const winner = top(styles) > top(nouns) ? styles : nouns;
  if (winner.length === 0) return [];
  const winnerTop = winner.reduce((m, x) => (x.score > m.score ? x : m), winner[0]);
  if (winnerTop.raw < BOARD_THRESHOLD) return [];
  return pickTags(winner, vocabMap, maxTags, BOARD_MARGIN);
}

// Words to keep off the cluster tags: the board-theme words themselves plus their near-synonyms.
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

// Always take the top word, then more while they stay near the top score, skipping near-synonyms already chosen.
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
 * Weight each member by how well it matches the tag, so the chip can sit at the weighted
 * centroid of the images it describes. Similarities are z-scored before the softmax because
 * CLIP's cross-modal cosines sit in a narrow band; without that the weights are nearly
 * uniform and every chip stacks at the center.
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

// Seeded k-means with k-means++ init over 2D points. Returns a cluster index per point.
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

// Mean silhouette score of an assignment. Higher means better-separated clusters.
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

/**
 * Centroid that ignores outliers. Take the mean, drop the farthest TRIM_FRACTION of members
 * by cosine to that mean, then re-average the rest. This keeps a label on the cluster's core
 * instead of letting one stray image pull it off. Embeddings are unit-normalized, so dot is cosine.
 */
function robustCentroid(vecs: Float32Array[]): Float32Array {
  const c0 = meanVector(vecs);
  const nDrop = Math.min(Math.floor(vecs.length * TRIM_FRACTION), Math.floor(vecs.length / 2));
  if (nDrop === 0) return c0;
  const kept = vecs
    .map((v) => ({ v, s: dot(v, c0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, vecs.length - nDrop)
    .map((x) => x.v);
  return meanVector(kept);
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
