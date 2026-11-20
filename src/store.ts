import { create } from 'zustand';
import { embedder } from './lib/embedder';
import { computeProjection } from './lib/cluster';
import { alignToReference } from './lib/align';
import { RAW } from './lib/raw';
import { GALLERY, GALLERY_BOARD_NAME, GALLERY_SAMPLES } from './lib/gallery';
import { blendVectors, dinoScale } from './lib/blend';
import { groupAndLabel, boardIdentity } from './lib/labeling';
import { VOCABULARY, LABEL_TEMPLATE } from './lib/vocabulary';
import { STYLE_VOCABULARY, STYLE_TEMPLATE } from './lib/style-vocabulary';
import { selectImages, toDisplayableImage } from './lib/images';
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
          .embedText(STYLE_VOCABULARY.map(STYLE_TEMPLATE))
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

  // boardId defaults to the active board. The gallery's AirDrop intake always targets the pinned board.
  addFiles: (files: File[], boardId?: string) => void;
  removeImage: (id: string) => void;
  setMode: (mode: Mode) => void;
  setAlpha: (alpha: number) => void;
  setBoardName: (name: string) => void;
  runCluster: () => Promise<void>;
  showClusters: () => Promise<void>;
  autoCluster: () => void;
  // In the gallery, a sample never overwrites the pinned board unless replace is set.
  loadSample: (id: string, opts?: { replace?: boolean }) => Promise<void>;
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
// In the gallery, the first board holds tonight's photos. It can't be deleted or overwritten.
export const PINNED_BOARD_ID = INITIAL_BOARD_ID;
// The gallery's sample boards are pinned too, under ids made from their sample.
const SAMPLE_BOARD_PREFIX = 'sample-';
const sampleOfBoard = (id: string) =>
  GALLERY && id.startsWith(SAMPLE_BOARD_PREFIX) ? id.slice(SAMPLE_BOARD_PREFIX.length) : null;
export const isPinned = (id: string) =>
  GALLERY && (id === PINNED_BOARD_ID || sampleOfBoard(id) !== null);
const INITIAL_NAME = GALLERY ? GALLERY_BOARD_NAME : '';
const INITIAL_BOARDS = [
  { id: INITIAL_BOARD_ID, name: INITIAL_NAME },
  ...(GALLERY
    ? GALLERY_SAMPLES.map((s) => ({ id: SAMPLE_BOARD_PREFIX + s.sample, name: s.name }))
    : []),
];

let autoClusterTimer: ReturnType<typeof setTimeout> | null = null;

// HEIC transcoding is async, and the user may switch boards before it finishes.
// Writes go to the board the files were dropped on, not whichever is active now.
function patchBoardImage(
  s: AppState,
  boardId: string,
  id: string,
  patch: Partial<ImageItem>,
): Partial<AppState> {
  const apply = (images: ImageItem[]) =>
    images.map((i) => (i.id === id ? { ...i, ...patch } : i));
  if (s.activeBoardId === boardId) {
    if (!s.images.some((i) => i.id === id)) return {};
    return { images: apply(s.images) };
  }
  const snap = s.saved[boardId];
  if (!snap || !snap.images.some((i) => i.id === id)) return {};
  return {
    saved: {
      ...s.saved,
      [boardId]: { ...snap, images: apply(snap.images) },
    },
  };
}

export const useStore = create<AppState>((set, get) => {
  // One clustering pass for the active board. runCluster wraps it so an error can't leave
  // the lock held.
  const clusterPass = async () => {
    set({ isClustering: true });
    // Map whatever is ready now instead of waiting for every upload. Photos still embedding
    // stay out of this pass, and each one that finishes calls autoCluster, so a burst of
    // AirDrops joins the map one by one and one slow photo can't hold up the board.
    await Promise.resolve();
    // Clustering is async, and the board can switch or change while it runs. Remember what
    // this pass is for, and only save the result if that still holds when it finishes.
    const boardId = get().activeBoardId;
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
    const raw = computeProjection(projInput);
    const projection = RAW ? raw : alignToReference(raw, reference);

    const [vocab, styleVocab] = await Promise.all([getVocab(), getStyleVocab()]);

    // Switched boards mid-pass: drop the result. switchBoard already freed the lock, and the
    // board this was for stays dirty, so it reclusters when it's back in front.
    if (get().activeBoardId !== boardId) return;
    // Same board, different photos: drop the result and run again on what's there now.
    const nowIds = get()
      .images.filter((i) => i.status === 'ready' && i.embedding)
      .map((i) => i.id);
    if (nowIds.length !== ids.length || nowIds.some((id, k) => id !== ids[k])) {
      set({ isClustering: false, dirty: true });
      get().autoCluster();
      return;
    }
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
      projectionRef: reference,
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
  };

  return {
  images: [],
  mode: 'grid',
  boardName: INITIAL_NAME,
  hasClustered: false,
  isClustering: false,
  projection: {},
  clusters: [],
  boardTags: [],
  samples: [],
  dirty: false,
  alpha: 0,
  projectionRef: null,
  boards: INITIAL_BOARDS,
  activeBoardId: INITIAL_BOARD_ID,
  saved: {},

  addFiles: (files, target) => {
    const boardId = target ?? get().activeBoardId;
    void (async () => {
      const accepted = await selectImages(files);
      if (accepted.length === 0) return;

      const items: ImageItem[] = await Promise.all(
        accepted.map(async (file) => {
          try {
            const display = await toDisplayableImage(file);
            return {
              id: crypto.randomUUID(),
              url: URL.createObjectURL(display),
              file: display,
              status: 'pending' as const,
            };
          } catch {
            return {
              id: crypto.randomUUID(),
              url: '',
              file,
              status: 'error' as const,
            };
          }
        }),
      );

      set((s) => {
        if (s.activeBoardId === boardId) {
          return { images: [...s.images, ...items], dirty: true };
        }
        const snap = s.saved[boardId];
        if (!snap) {
          for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
          return {};
        }
        return {
          saved: {
            ...s.saved,
            [boardId]: { ...snap, images: [...snap.images, ...items], dirty: true },
          },
        };
      });

      for (const item of items) {
        if (item.status !== 'pending' || !item.file) continue;
        embedder
          .embed(item.id, item.file)
          .then(({ clip, dino }) => {
            set((s) =>
              patchBoardImage(s, boardId, item.id, {
                embedding: clip,
                dinoEmbedding: dino,
                status: 'ready',
              }),
            );
            if (get().activeBoardId === boardId) get().autoCluster();
          })
          .catch(() => {
            set((s) => patchBoardImage(s, boardId, item.id, { status: 'error' }));
            if (get().activeBoardId === boardId) get().autoCluster();
          });
      }
    })();
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

  // Any error mid-pass must still release the lock, or the board stays on "Mapping…" for
  // good and every later photo piles up unmapped.
  runCluster: async () => {
    if (get().isClustering) return;
    try {
      await clusterPass();
    } catch (e) {
      console.error('clustering failed', e);
      set({ isClustering: false });
    }
  },
  loadSample: async (id, opts) => {
    // Keep tonight's photos safe: a sample never lands on the gallery board by accident.
    if (get().activeBoardId === PINNED_BOARD_ID && GALLERY && !opts?.replace) get().newBoard();
    // The fetch is async. If the board changes before it returns, drop the result instead
    // of filling whichever board is in front by then.
    const boardId = get().activeBoardId;
    const base = import.meta.env.BASE_URL;
    let board: { images: { file: string; embedding: number[]; dino?: number[] }[] };
    try {
      board = await (await fetch(`${base}samples/${id}/board.json`)).json();
    } catch {
      return;
    }
    if (get().activeBoardId !== boardId) return;
    // Free object URLs from any uploaded images (samples use plain paths).
    for (const img of get().images) if (img.file) URL.revokeObjectURL(img.url);

    const images: ImageItem[] = board.images.map((im) => ({
      id: crypto.randomUUID(),
      url: `${base}samples/${id}/${im.file}`,
      embedding: Float32Array.from(im.embedding),
      dinoEmbedding: im.dino ? Float32Array.from(im.dino) : undefined,
      status: 'ready' as const,
    }));
    // Pinned gallery boards keep their names. Any other board is renamed from its theme.
    set((s) => ({
      images,
      boardName: isPinned(s.activeBoardId) ? s.boardName : '',
      boards: s.boards.map((b) =>
        b.id === s.activeBoardId && !isPinned(b.id) ? { ...b, name: '' } : b,
      ),
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
      // A board never opened before starts empty but keeps the name it was listed under.
      ...(s.saved[id] ?? { ...EMPTY_BOARD, boardName: s.boards.find((b) => b.id === id)?.name ?? '' }),
    });
    // The gallery lives on the map: a board with photos opens there. Otherwise, photos can
    // land on a board while it's in the background, like AirDrops to the gallery board, so
    // recluster once it's back in front.
    if (GALLERY) void get().showClusters();
    else if (get().dirty) get().autoCluster();
    // A pinned sample board loads its photos the first time it's opened, onto the map.
    const sample = sampleOfBoard(id);
    if (sample && get().images.length === 0) {
      void get()
        .loadSample(sample, { replace: true })
        .then(() => {
          if (get().activeBoardId === id) return get().showClusters();
        });
    }
  },

  // Remove a board, always keeping at least one. Free its object URLs, and if it was active fall back to a neighbour.
  deleteBoard: (id) => {
    const s = get();
    if (s.boards.length <= 1 || isPinned(id)) return;
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
};
});
