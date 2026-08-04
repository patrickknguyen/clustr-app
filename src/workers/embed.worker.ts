/// <reference lib="webworker" />
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

// Small, fast CLIP. Vision tower for images, text tower for zero-shot labels.
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

type EmbedRequest = { type: 'embed'; id: string; blob: Blob };
type EmbedTextRequest = { type: 'embedText'; id: string; texts: string[] };
type Request = EmbedRequest | EmbedTextRequest;

let processorPromise: Promise<unknown> | null = null;
let visionPromise: Promise<unknown> | null = null;
let tokenizerPromise: Promise<unknown> | null = null;
let textPromise: Promise<unknown> | null = null;

async function withFallback<T>(load: (device: 'webgpu' | 'wasm', dtype: 'fp32' | 'q8') => Promise<T>) {
  try {
    return await load('webgpu', 'fp32');
  } catch {
    return await load('wasm', 'q8');
  }
}

async function getVision() {
  if (!processorPromise) processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  if (!visionPromise) {
    visionPromise = withFallback((device, dtype) =>
      CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { device, dtype }),
    );
  }
  const [processor, model] = await Promise.all([processorPromise, visionPromise]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { processor: processor as any, model: model as any };
}

async function getText() {
  if (!tokenizerPromise) tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  if (!textPromise) {
    textPromise = withFallback((device, dtype) =>
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { device, dtype }),
    );
  }
  const [tokenizer, model] = await Promise.all([tokenizerPromise, textPromise]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tokenizer: tokenizer as any, model: model as any };
}

function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

async function handleImage(data: EmbedRequest) {
  const { id, blob } = data;
  try {
    const { processor, model } = await getVision();
    const image = await RawImage.fromBlob(blob);
    const inputs = await processor(image);
    const { image_embeds } = await model(inputs);
    const embedding = l2normalize(image_embeds.data as Float32Array);
    (self as unknown as Worker).postMessage({ type: 'result', id, embedding }, [
      embedding.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleText(data: EmbedTextRequest) {
  const { id, texts } = data;
  try {
    const { tokenizer, model } = await getText();
    const inputs = tokenizer(texts, { padding: true, truncation: true });
    const { text_embeds } = await model(inputs);
    const [n, dim] = text_embeds.dims as [number, number];
    const flat = text_embeds.data as Float32Array;
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      embeddings.push(l2normalize(flat.slice(i * dim, (i + 1) * dim)));
    }
    (self as unknown as Worker).postMessage({ type: 'textResult', id, embeddings });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Serialize requests so we never run two model passes at once in this worker.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<Request>) => {
  const data = e.data;
  if (data?.type === 'embed') chain = chain.then(() => handleImage(data));
  else if (data?.type === 'embedText') chain = chain.then(() => handleText(data));
};
