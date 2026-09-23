import { create } from 'zustand';
import { embedder } from './lib/embedder';
import { computeProjection } from './lib/cluster';
import { alignToReference } from './lib/align';
import { blendVectors, dinoScale } from './lib/blend';
import { groupAndLabel, boardIdentity } from './lib/labeling';
import { VOCABULARY, LABEL_TEMPLATE } from './lib/vocabulary';
import { STYLE_VOCABULARY } from './lib/style-vocabulary';
import type { Cluster, ImageItem, Mode, Point } from './types';

// Load the label vocab once. Prefer the precomputed public/vocab.json, otherwise embed it in the worker.
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
        vocabPromise = null;
        return [];
      });
  }
  return vocabPromise;
}

// Style vocab for the DINO end of the slider. Loads the same way as getVocab.
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
  // Raw UMAP coords by image id. The view converts them to pixels.
  projection: Record<string, Point>;
  clusters: Cluster[];
  boardTags: string[];
  samples: string[];
  dirty: boolean;
  // 0 is pure CLIP (semantic), 1 is pure DINO (visual).
  alpha: number;
  // Stable frame that later blends align to, so the map doesn't spin as alpha changes.
  projectionRef: Record<string, Point> | null;

  // In-session boards (not persisted). The fields above hold the active board; the rest live in saved.
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
  newBoard: () => void;
  switchBoard: (id: string) => void;
  deleteBoard: (id: string) => void;
}

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
          get().autoCluster();
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

  // If the map is already open, reflow now. Otherwise mark dirty so opening it recomputes.
  setAlpha: (alpha) => {
    set({ alpha });
    if (get().mode === 'cluster' && get().hasClustered) get().runCluster();
    else set({ dirty: true });
  },

  showClusters: async () => {
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding).length;
    if (ready < 2) return;
    if (get().dirty || !get().hasClustered) await get().runCluster();
    set({ mode: 'cluster' });
  },

  // Debounced background clustering. Coalesces rapid uploads and never overlaps a running pass.
  autoCluster: () => {
    if (autoClusterTimer) clearTimeout(autoClusterTimer);
    autoClusterTimer = setTimeout(() => {
      autoClusterTimer = null;
      const s = get();
      if (s.isClustering) return void s.autoCluster();
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
    if (get().isClustering) return;
    set({ isClustering: true });
    // Wait for any in-flight embeddings so none get dropped.
    await embedder.whenIdle();
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding);
    if (ready.length < 2) {
      set({ isClustering: false });
      return;
    }
    const alpha = get().alpha;
    const allHaveDino = ready.every((i) => i.dinoEmbedding);

    // The reference frame is the pure-CLIP layout, computed once per image set and reused for every blend.
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

    // Blend CLIP and DINO for the layout when every image has a DINO vector. Labels always use CLIP.
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
    const projection = alignToReference(computeProjection(projInput), reference);

    const [vocab, styleVocab] = await Promise.all([getVocab(), getStyleVocab()]);
    // Board identity is fixed per image set and independent of alpha, so the board name never drifts.
    const boardTags =
      sameSet && get().boardTags.length
        ? get().boardTags
        : boardIdentity(ready.map((i) => i.embedding!), vocab, styleVocab);
    const { clusters } = groupAndLabel(
      ready.map((i) => ({
        id: i.id,
        embedding: i.embedding!,
        coord: projection[i.id],
      })),
      vocab,
      styleVocab,
      alpha,
      boardTags,
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
      get().setBoardName(title);
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
    // Free object URLs from any uploaded images (samples use plain paths).
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
  },

  initSamples: async () => {
    const base = import.meta.env.BASE_URL;
    try {
      const list: { id: string; count: number }[] = await (
        await fetch(`${base}samples/index.json`)
      ).json();
      set({ samples: list.map((b) => b.id) });
    } catch {
      // No samples built yet, so just start empty.
    }
  },

  // Save the current board and start a fresh empty one.
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

  // Save the current board and restore the target. Object URLs stay alive.
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

  // Remove a board, always keeping at least one. Free its object URLs, and if it was active fall back to a neighbour.
  deleteBoard: (id) => {
    const s = get();
    if (s.boards.length <= 1) return;
    const snapshot = id === s.activeBoardId ? captureBoard(s) : s.saved[id];
    if (snapshot) for (const img of snapshot.images) if (img.file) URL.revokeObjectURL(img.url);

    const boards = s.boards.filter((b) => b.id !== id);
    const { [id]: _dropped, ...saved } = s.saved;
    if (id !== s.activeBoardId) {
      set({ boards, saved });
      return;
    }
    const nextId = boards[0].id;
    set({
      boards,
      saved,
      activeBoardId: nextId,
      isClustering: false,
      ...(saved[nextId] ?? EMPTY_BOARD),
    });
  },
}));
