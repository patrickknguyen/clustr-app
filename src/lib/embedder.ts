// Main-thread manager around a single embedding worker.
// One worker keeps memory sane (one model copy) and processes a FIFO queue,
// so images embed in the background while the user keeps arranging.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

type WorkerMessage =
  | { type: 'result'; id: string; embedding: Float32Array }
  | { type: 'textResult'; id: string; embeddings: Float32Array[] }
  | { type: 'error'; id: string; message: string };

class Embedder {
  private worker: Worker;
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor() {
    this.worker = new Worker(
      new URL('../workers/embed.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.embedding);
      else if (msg.type === 'textResult') p.resolve(msg.embeddings);
      else p.reject(new Error(msg.message));
    };
  }

  embed(id: string, blob: Blob): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'embed', id, blob });
    });
  }

  /** Embed a batch of text strings; resolves to one normalized vector each. */
  embedText(texts: string[]): Promise<Float32Array[]> {
    const id = `text-${this.seq++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'embedText', id, texts });
    });
  }

  /** Resolves once every queued embedding has settled. */
  whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.pending.size === 0) resolve();
        else setTimeout(check, 60);
      };
      check();
    });
  }
}

export const embedder = new Embedder();
