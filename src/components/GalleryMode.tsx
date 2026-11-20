import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PINNED_BOARD_ID, useStore } from '../store';
import { GALLERY_BOARD_NAME, GALLERY_COPY, GALLERY_SAMPLE } from '../lib/gallery';
import { watchRelay } from '../lib/airdrop-relay';
import { downscaleImage, selectImages, toDisplayableImage } from '../lib/images';

const IDLE_MS = 40_000; // no input for this long and the screen returns to the attract loop
const STEP_MS = 1_500; // one slider move: the 0.9 s regroup, then a beat to read the labels
// Subject to look and back in quarter steps, so each move regroups a little.
const SWEEP = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25];
const MIN_FOR_LOOP = 4; // fewer photos than this and there's nothing to sort yet

let sampleStarted = false;

// The exhibition layer for ?gallery: an attract loop, the invitation card, and the AirDrop
// intake. It drives the app through the same store actions a visitor's hands would.
export function GalleryMode() {
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);
  const readyCount = useStore(
    (s) => s.images.filter((i) => i.status === 'ready' && i.embedding).length,
  );
  const activeBoardId = useStore((s) => s.activeBoardId);

  // Any input hands the screen to the visitor. Escape hands it straight back.
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.clearTimeout(idleTimer.current);
        setIdle(true);
      } else wake();
    };
    const events = ['pointerdown', 'pointermove', 'wheel'] as const;
    events.forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
    window.addEventListener('keydown', onKey);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, wake));
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  // Optional starting board, for rehearsal or as a backup if the AirDrop intake fails.
  // Loaded once per page, even though React's dev mode runs effects twice.
  useEffect(() => {
    if (!GALLERY_SAMPLE || sampleStarted) return;
    sampleStarted = true;
    void (async () => {
      await useStore.getState().loadSample(GALLERY_SAMPLE, { replace: true });
      await useStore.getState().showClusters();
    })();
  }, []);

  // An idle screen always shows tonight's board, so visitors who walk away leave it there.
  useEffect(() => {
    if (idle && activeBoardId !== PINNED_BOARD_ID) useStore.getState().switchBoard(PINNED_BOARD_ID);
  }, [idle, activeBoardId]);

  // The gallery lives on the map. Open it whenever the screen is idle and the board first
  // has enough photos.
  useEffect(() => {
    if (!idle || readyCount < 2) return;
    const s = useStore.getState();
    if (s.mode !== 'cluster') void s.showClusters();
  }, [idle, readyCount]);

  // The attract loop: step the slider through the sweep while nobody is at the laptop.
  const canLoop = idle && readyCount >= MIN_FOR_LOOP;
  useEffect(() => {
    if (!canLoop) return;
    let step = 0;
    const tick = () => {
      const s = useStore.getState();
      // Skip a beat rather than queue up moves while the last one is still regrouping.
      if (s.isClustering || s.mode !== 'cluster') return;
      s.setAlpha(SWEEP[step % SWEEP.length]);
      step++;
    };
    const id = window.setInterval(tick, STEP_MS);
    return () => window.clearInterval(id);
  }, [canLoop]);

  return (
    <>
      <InfoCard idle={idle} />
      <AirDropIntake />
    </>
  );
}

const CARD_EASE = [0.16, 1, 0.3, 1] as const;

// The invitation. Always on screen: open while the screen is idle, and a visitor can fold
// it down to a small tab while they use the demo, then open it again to reread it.
function InfoCard({ idle }: { idle: boolean }) {
  const [open, setOpen] = useState(true);
  // Each new visitor finds it open: going idle unfolds it again.
  const [wasIdle, setWasIdle] = useState(idle);
  if (wasIdle !== idle) {
    setWasIdle(idle);
    if (idle) setOpen(true);
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {open ? (
        <motion.aside
          key="card"
          className="gallery-card"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25, ease: CARD_EASE }}
        >
          <div className="gallery-card-head">
            <h2 className="gallery-card-title">About Clustr | {GALLERY_BOARD_NAME}</h2>
            <button
              className="gallery-card-hide"
              onClick={() => setOpen(false)}
              aria-label="Minimize"
              title="Minimize"
            >
              –
            </button>
          </div>
          <p className="gallery-card-body">
            Clustr sorts a moodboard into groups and names what each group shares. A slider
            blends grouping by subject with grouping by look.
          </p>
          <p className="gallery-card-callout">
            AirDrop photos from tonight to
            <br />
            <strong>{GALLERY_COPY.airdropName}</strong> to add to the
            <br />
            <strong>{GALLERY_BOARD_NAME}</strong> moodboard!
          </p>
        </motion.aside>
      ) : (
        <motion.button
          key="tab"
          className="gallery-card-tab"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: CARD_EASE }}
        >
          About Clustr | {GALLERY_BOARD_NAME}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// Tonight's photos arrive on their own: the relay serves the gallery folder and this polls
// it from page load. It renders nothing.
function AirDropIntake() {
  const addFiles = useStore((s) => s.addFiles);

  const ingest = useCallback(
    async (files: File[]) => {
      const images = await selectImages(files);
      const ready = await Promise.all(
        images.map(async (f) => {
          try {
            return await downscaleImage(await toDisplayableImage(f));
          } catch {
            return f;
          }
        }),
      );
      if (ready.length === 0) return;
      addFiles(ready, PINNED_BOARD_ID);
    },
    [addFiles],
  );

  useEffect(() => watchRelay((files) => void ingest(files)), [ingest]);

  return null;
}
