// Client for scripts/airdrop-relay.py. The relay moves each AirDrop into
// ~/Downloads/clustr-gallery and serves that folder on this Mac, so the gallery can pick up
// photos with no clicks and no browser folder permission.
import { RELAY_URL } from './gallery';

/**
 * Poll the relay and hand over each photo once. Everything already in the folder counts,
 * so a page reload rebuilds the board. onStatus, if given, reports whether the relay
 * answered.
 * Returns a stop function.
 */
export function watchRelay(
  onFiles: (files: File[]) => void,
  onStatus: (connected: boolean) => void = () => {},
  intervalMs = 1500,
): () => void {
  const seen = new Set<string>();
  let busy = false;
  let stopped = false;

  const poll = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const res = await fetch(`${RELAY_URL}/photos`, { cache: 'no-store' });
      const names: string[] = await res.json();
      onStatus(true);
      const fresh: File[] = [];
      for (const name of names) {
        if (seen.has(name)) continue;
        try {
          const r = await fetch(`${RELAY_URL}/photos/${encodeURIComponent(name)}`, {
            cache: 'no-store',
          });
          if (!r.ok) continue;
          const blob = await r.blob();
          fresh.push(new File([blob], name, { type: blob.type }));
          seen.add(name);
        } catch {
          // Leave it unseen so the next poll tries this photo again.
        }
      }
      if (fresh.length && !stopped) onFiles(fresh);
    } catch {
      onStatus(false);
    } finally {
      busy = false;
    }
  };

  void poll();
  const id = window.setInterval(poll, intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}
