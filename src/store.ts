import { create } from 'zustand';
import { embedder } from './lib/embedder';
import { computeProjection } from './lib/cluster';
import { groupAndLabel } from './lib/labeling';
import { VOCABULARY, LABEL_TEMPLATE } from './lib/vocabulary';
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

  addFiles: (files: File[]) => void;
  removeImage: (id: string) => void;
  setMode: (mode: Mode) => void;
  setBoardName: (name: string) => void;
  runCluster: () => Promise<void>;
  showClusters: () => Promise<void>;
  loadSample: (id: string) => Promise<void>;
  initSamples: () => Promise<void>;
  clearAll: () => void;
}

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
        .then((embedding) =>
          set((s) => ({
            images: s.images.map((i) =>
              i.id === item.id ? { ...i, embedding, status: 'ready' } : i,
            ),
          })),
        )
        .catch(() =>
          set((s) => ({
            images: s.images.map((i) =>
              i.id === item.id ? { ...i, status: 'error' } : i,
            ),
          })),
        );
    }
  },

  removeImage: (id) =>
    set((s) => {
      const img = s.images.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return { images: s.images.filter((i) => i.id !== id), dirty: true };
    }),

  setMode: (mode) => set({ mode }),

  // Clusters tab is the trigger: recompute if the board changed, else just show.
  showClusters: async () => {
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding).length;
    if (ready < 2) return;
    if (get().dirty || !get().hasClustered) await get().runCluster();
    else set({ mode: 'cluster' });
  },

  setBoardName: (name) => set({ boardName: name }),

  runCluster: async () => {
    set({ isClustering: true });
    // Make sure every in-flight embedding has finished so nothing is dropped.
    await embedder.whenIdle();
    const ready = get().images.filter((i) => i.status === 'ready' && i.embedding);
    if (ready.length < 2) {
      set({ isClustering: false });
      return;
    }
    const projection = computeProjection(
      ready.map((i) => ({ id: i.id, embedding: i.embedding! })),
    );
    // Group spatially + tag each group from the CLIP text vocabulary.
    const vocab = await getVocab();
    const { clusters, boardTags } = groupAndLabel(
      ready.map((i) => ({
        id: i.id,
        embedding: i.embedding!,
        coord: projection[i.id],
      })),
      vocab,
    );
    set({
      projection,
      clusters,
      boardTags,
      hasClustered: true,
      dirty: false,
      mode: 'cluster',
      isClustering: false,
    });
    // Auto-name the board from its theme, unless the user already named it.
    if (!get().boardName.trim() && boardTags.length) {
      const title = boardTags.map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase())).join(' ');
      set({ boardName: `${title} Board` });
    }
  },

  loadSample: async (id) => {
    const base = import.meta.env.BASE_URL;
    let board: { images: { file: string; embedding: number[] }[] };
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
      status: 'ready' as const,
    }));
    set({
      images,
      boardName: '',
      projection: {},
      clusters: [],
      boardTags: [],
      hasClustered: false,
      dirty: true,
      mode: 'grid',
    });
    // Land in the library; opening the Clusters tab triggers the morph.
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

  clearAll: () =>
    set((s) => {
      for (const img of s.images) if (img.file) URL.revokeObjectURL(img.url);
      return {
        images: [],
        projection: {},
        clusters: [],
        boardTags: [],
        boardName: '',
        hasClustered: false,
        dirty: false,
        mode: 'grid',
      };
    }),
}));
