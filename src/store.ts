import { create } from 'zustand';
import { embedder } from './lib/embedder';
import { computeProjection } from './lib/cluster';
import { alignToReference } from './lib/align';
import { blendVectors, dinoScale } from './lib/blend';
import { groupAndLabel } from './lib/labeling';
import { VOCABULARY, LABEL_TEMPLATE } from './lib/vocabulary';
import { STYLE_VOCABULARY } from './lib/style-vocabulary';
import type { Cluster, ImageItem, Mode, Point } from './types';

/**
 * Load the label vocabulary once. Prefers the shipped `public/vocab.json`
 * (precomputed, so the text model never downloads); falls back to embedding it
 * in the worker if that file isn't present (e.g. before `npm run build:samples`).
 */
let vocabPromise: Promise<{ word: string; vec: Float32Array }[]> | null = null;
function getVocab() {
  if (!vocabPromise) {
    vocabPromise = fetch(`${import.meta.env.BASE_URL}vocab.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no vocab.json'))))
      .then((data: { word: string; embedding: number[] }[]) =>
        data.map((d) => ({ word: d.word, vec: Float32Array.from(d.embedding) })),
      )
      .catch(() =>
        embedder
          .embedText(VOCABULARY.map(LABEL_TEMPLATE))
          .then((vecs) => VOCABULARY.map((word, i) => ({ word, vec: vecs[i] }))),
      )
      .catch(() => {
        vocabPromise = null; // allow retry on next cluster
        return [];
      });
  }
  return vocabPromise;
}

/** Style/aesthetic vocabulary for the DINO end of the slider. Same load strategy as
 *  getVocab (prefer the precomputed JSON, fall back to embedding in the worker). */
let styleVocabPromise: Promise<{ word: string; vec: Float32Array }[]> | null = null;
function getStyleVocab() {
  if (!styleVocabPromise) {
    styleVocabPromise = fetch(`${import.meta.env.BASE_URL}style-vocab.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no style-vocab.json'))))
      .then((data: { word: string; embedding: number[] }[]) =>
        data.map((d) => ({ word: d.word, vec: Float32Array.from(d.embedding) })),
      )
      .catch(() =>
        embedder
          .embedText(STYLE_VOCABULARY.map(LABEL_TEMPLATE))
          .then((vecs) => STYLE_VOCABULARY.map((word, i) => ({ word, vec: vecs[i] }))),
      )
      .catch(() => {
        styleVocabPromise = null;
        return [];
      });
  }
  return styleVocabPromise;
}

interface AppState {
  images: ImageItem[];
  mode: Mode;
  boardName: string;
  hasClustered: boolean;
  isClustering: boolean;
  /** Raw UMAP coords, keyed by image id. View layer maps these to pixels. */
  projection: Record<string, Point>;
  clusters: Cluster[];
  /** Theme shared by the whole board (may be empty). */
  boardTags: string[];
  /** Ids of the bundled sample boards. */
  samples: string[];
  /** True when images changed since the last cluster, so Clusters recomputes. */
  dirty: boolean;
  /** Blend: 0 = pure CLIP (semantic), 1 = pure DINO (visual/by-look). */
  alpha: number;
  /** Stable projection frame (first computed for the current image set); later blends
   *  are Procrustes-aligned to it so the map doesn't spin/flip as the slider moves. */
  projectionRef: Record<string, Point> | null;

  /** In-session boards (not persisted). The fields above are the *active* board's live
   *  state; other boards are stashed in `saved` and swapped in on switch. */
  boards: { id: string; name: string }[];
  activeBoardId: string;
  saved: Record<string, BoardSnapshot>;

  addFiles: (files: File[]) => void;
  removeImage: (id: string) => void;
  setMode: (mode: Mode) => void;
  setAlpha: (alpha: number) => void;
  setBoardName: (name: string) => void;
  runCluster: () => Promise<void>;
  showClusters: () => Promise<void>;
  autoCluster: () => void;
  loadSample: (id: string) => Promise<void>;
  initSamples: () => Promise<void>;
  clearAll: () => void;
  newBoard: () => void;
  switchBoard: (id: string) => void;
}

// The per-board state we stash when switching away and restore when switching back.
type BoardSnapshot = {
  images: ImageItem[];
  boardName: string;
  mode: Mode;
  hasClustered: boolean;
  projection: Record<string, Point>;
  clusters: Cluster[];
  boardTags: string[];
  dirty: boolean;
  alpha: number;
  projectionRef: Record<string, Point> | null;
};
const EMPTY_BOARD: BoardSnapshot = {
  images: [],
  boardName: '',
  mode: 'grid',
  hasClustered: false,
  projection: {},
  clusters: [],
  boardTags: [],
  dirty: false,
  alpha: 0,
  projectionRef: null,
};
const captureBoard = (s: AppState): BoardSnapshot => ({
  images: s.images,
  boardName: s.boardName,
  mode: s.mode,
  hasClustered: s.hasClustered,
  projection: s.projection,
  clusters: s.clusters,
  boardTags: s.boardTags,
  dirty: s.dirty,
  alpha: s.alpha,
  projectionRef: s.projectionRef,
});
const INITIAL_BOARD_ID = 'board-1';

let autoClusterTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => ({
  images: [],
  mode: 'grid',
  boardName: '',
  hasClustered: false,
  isClustering: false,
  projection: {},
  clusters: [],
  boardTags: [],
  samples: [],
  dirty: false,
  alpha: 0,
  projectionRef: null,
  boards: [{ id: INITIAL_BOARD_ID, name: '' }],
  activeBoardId: INITIAL_BOARD_ID,
  saved: {},

  addFiles: (files) => {
    const items: ImageItem[] = files
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(f),
        file: f,
        status: 'pending' as const,
      }));
    if (items.length === 0) return;

    set((s) => ({ images: [...s.images, ...items], dirty: true }));

    // Fire embeddings in the background — don't block the UI.
    for (const item of items) {
      if (!item.file) continue;
      embedder
        .embed(item.id, item.file)
        .then(({ clip, dino }) => {
          set((s) => ({
            images: s.images.map((i) =>
              i.id === item.id
                ? { ...i, embedding: clip, dinoEmbedding: dino, status: 'ready' }
                : i,
            ),
          }));
          get().autoCluster(); // cluster once this (and any sibling) embeddings settle
        })
        .catch(() => {
          set((s) => ({
            images: s.images.map((i) =>
              i.id === item.id ? { ...i, status: 'error' } : i,
            ),
          }));
          get().autoCluster();
        });
    }
  },

  removeImage: (id) =>
    set((s) => {
      const img = s.images.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return { images: s.images.filter((i) => i.id !== id), dirty: true };
    }),

  setMode: (mode) => set({ mode }),

  // Slider commits on release. Reflow immediately if we're already on the Clusters
  // map; otherwise just mark dirty so opening Clusters recomputes with the new blend.
  setAlpha: (alpha) => {
    set({ alpha });
    if (get().mode === 'cluster' && get().hasClustered) get().runCluster();
    else set({ dirty: true });
  },

  // Opening the Map shows the (usually already-computed) clusters. Recompute only if it
  // somehow wasn't auto-clustered yet; the grid→map morph plays as mode flips.
  showClusters: async () => {
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding).length;
    if (ready < 2) return;
    if (get().dirty || !get().hasClustered) await get().runCluster();
    set({ mode: 'cluster' });
  },

  // Debounced background clustering: fires once embeddings settle, coalescing rapid
  // one-by-one uploads into a single run and never overlapping an in-flight one. The
  // Map is kept fresh so opening it is instant.
  autoCluster: () => {
    if (autoClusterTimer) clearTimeout(autoClusterTimer);
    autoClusterTimer = setTimeout(() => {
      autoClusterTimer = null;
      const s = get();
      if (s.isClustering) return void s.autoCluster(); // busy — try again shortly
      const ready = s.images.filter((i) => i.status === 'ready' && i.embedding).length;
      if (s.dirty && ready >= 2) s.runCluster();
    }, 300);
  },

  setBoardName: (name) =>
    set((s) => ({
      boardName: name,
      boards: s.boards.map((b) => (b.id === s.activeBoardId ? { ...b, name } : b)),
    })),

  runCluster: async () => {
    if (get().isClustering) return; // a run is already in flight; autoCluster will retry
    set({ isClustering: true });
    // Make sure every in-flight embedding has finished so nothing is dropped.
    await embedder.whenIdle();
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding);
    if (ready.length < 2) {
      set({ isClustering: false });
      return;
    }
    // Blend CLIP↔DINO for the layout/grouping when we have DINO for every image
    // (samples always; uploads once the worker fills it in). Labels still use CLIP.
    const alpha = get().alpha;
    const allHaveDino = ready.every((i) => i.dinoEmbedding);

    // Deterministic anchor for this image set = the pure-CLIP (α=0) layout, computed
    // once and reused for every blend. So a board looks identical no matter which α you
    // land on or whether you just switched boards — the frame never depends on history.
    const ids = ready.map((i) => i.id);
    const existing = get().projectionRef;
    const sameSet =
      existing !== null &&
      ids.length === Object.keys(existing).length &&
      ids.every((id) => existing[id]);
    const reference = sameSet
      ? existing!
      : computeProjection(ready.map((i) => ({ id: i.id, embedding: i.embedding! })));
    if (!sameSet) set({ projectionRef: reference });

    const projInput =
      alpha > 0 && allHaveDino
        ? blendVectors(
            ready.map((i) => ({ id: i.id, clip: i.embedding!, dino: i.dinoEmbedding! })),
            alpha,
            dinoScale(
              ready.map((i) => i.embedding!),
              ready.map((i) => i.dinoEmbedding!),
            ),
          )
        : ready.map((i) => ({ id: i.id, embedding: i.embedding! }));
    // At α=0 this aligns the CLIP layout to itself (identity); at higher α it snaps the
    // blended layout onto the same CLIP frame.
    const projection = alignToReference(computeProjection(projInput), reference);
    // Group spatially + tag each group, blending subject↔style vocab by the same alpha
    // that drives the layout, so labels shift from "what it is" to "how it looks".
    const [vocab, styleVocab] = await Promise.all([getVocab(), getStyleVocab()]);
    const { clusters, boardTags } = groupAndLabel(
      ready.map((i) => ({
        id: i.id,
        embedding: i.embedding!,
        coord: projection[i.id],
      })),
      vocab,
      styleVocab,
      alpha,
    );
    set({
      projection,
      clusters,
      boardTags,
      hasClustered: true,
      dirty: false,
      isClustering: false,
    });
    // Auto-name the board from its theme, unless the user already named it.
    if (!get().boardName.trim() && boardTags.length) {
      const title = boardTags.map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase())).join(' ');
      get().setBoardName(`${title} Board`); // syncs the board-switcher name too
    }
  },

  loadSample: async (id) => {
    const base = import.meta.env.BASE_URL;
    let board: { images: { file: string; embedding: number[]; dino?: number[] }[] };
    try {
      board = await (await fetch(`${base}samples/${id}/board.json`)).json();
    } catch {
      return;
    }
    // Revoke object URLs from any uploaded images (sample URLs are plain paths).
    for (const img of get().images) if (img.file) URL.revokeObjectURL(img.url);

    const images: ImageItem[] = board.images.map((im) => ({
      id: crypto.randomUUID(),
      url: `${base}samples/${id}/${im.file}`,
      embedding: Float32Array.from(im.embedding),
      dinoEmbedding: im.dino ? Float32Array.from(im.dino) : undefined,
      status: 'ready' as const,
    }));
    set((s) => ({
      images,
      boardName: '',
      boards: s.boards.map((b) => (b.id === s.activeBoardId ? { ...b, name: '' } : b)),
      projection: {},
      projectionRef: null,
      clusters: [],
      boardTags: [],
      hasClustered: false,
      dirty: true,
      mode: 'grid',
    }));
    // Land in the library; opening the Map tab triggers the morph.
  },

  initSamples: async () => {
    const base = import.meta.env.BASE_URL;
    try {
      const list: { id: string; count: number }[] = await (
        await fetch(`${base}samples/index.json`)
      ).json();
      const ids = list.map((b) => b.id);
      set({ samples: ids });
      // Auto-load the first board so the landing isn't a blank canvas.
      if (ids.length && get().images.length === 0) get().loadSample(ids[0]);
    } catch {
      // No samples built yet — fine, the app just starts empty.
    }
  },

  // Stash the current board and start a fresh empty one (lands in the library).
  newBoard: () => {
    const id = crypto.randomUUID();
    set((s) => ({
      saved: { ...s.saved, [s.activeBoardId]: captureBoard(s) },
      boards: [...s.boards, { id, name: '' }],
      activeBoardId: id,
      isClustering: false,
      ...EMPTY_BOARD,
    }));
  },

  // Stash the current board, restore the target's state (or empty). Object URLs stay
  // alive — we're keeping the board in memory, not discarding it.
  switchBoard: (id) => {
    const s = get();
    if (id === s.activeBoardId) return;
    set({
      saved: { ...s.saved, [s.activeBoardId]: captureBoard(s) },
      activeBoardId: id,
      isClustering: false,
      ...(s.saved[id] ?? EMPTY_BOARD),
    });
  },

  clearAll: () =>
    set((s) => {
      for (const img of s.images) if (img.file) URL.revokeObjectURL(img.url);
      return {
        images: [],
        projection: {},
        projectionRef: null,
        clusters: [],
        boardTags: [],
        boardName: '',
        boards: s.boards.map((b) => (b.id === s.activeBoardId ? { ...b, name: '' } : b)),
        hasClustered: false,
        dirty: false,
        mode: 'grid',
      };
    }),
}));
