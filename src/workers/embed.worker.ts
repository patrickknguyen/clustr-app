/// <reference lib="webworker" />
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

// CLIP vision + text towers (image embeddings + zero-shot labels); DINOv2 CLS token (by-look axis).
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DINO_ID = 'Xenova/dinov2-small';

type EmbedRequest = { type: 'embed'; id: string; blob: Blob };
type EmbedTextRequest = { type: 'embedText'; id: string; texts: string[] };
type WarmRequest = { type: 'warm' };
type Request = EmbedRequest | EmbedTextRequest | WarmRequest;

let processorPromise: Promise<unknown> | null = null;
let visionPromise: Promise<unknown> | null = null;
let tokenizerPromise: Promise<unknown> | null = null;
let textPromise: Promise<unknown> | null = null;
let dinoProcessorPromise: Promise<unknown> | null = null;
let dinoPromise: Promise<unknown> | null = null;

// fp32 to match the fp32 sample embeddings (q8 drifts to about 0.89-0.93 cosine). Prefer WebGPU, else wasm.
async function withFallback<T>(load: (device: 'webgpu' | 'wasm', dtype: 'fp32') => Promise<T>) {
  try {
    return await load('webgpu', 'fp32');
  } catch {
    return await load('wasm', 'fp32');
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

async function getDino() {
  if (!dinoProcessorPromise) dinoProcessorPromise = AutoProcessor.from_pretrained(DINO_ID);
  if (!dinoPromise) {
    dinoPromise = withFallback((device, dtype) => AutoModel.from_pretrained(DINO_ID, { device, dtype }));
  }
  const [processor, model] = await Promise.all([dinoProcessorPromise, dinoPromise]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { processor: processor as any, model: model as any };
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
    const image = await RawImage.fromBlob(blob);
    const [{ processor, model }, dino] = await Promise.all([getVision(), getDino()]);
    const { image_embeds } = await model(await processor(image));
    const embedding = l2normalize(image_embeds.data as Float32Array);
    // DINOv2 CLS token: the first dim values of last_hidden_state.
    const out = await dino.model(await dino.processor(image));
    const t = out.last_hidden_state;
    const dim = t.dims[t.dims.length - 1] as number;
    const dinoEmbedding = l2normalize((t.data as Float32Array).slice(0, dim));
    (self as unknown as Worker).postMessage({ type: 'result', id, embedding, dino: dinoEmbedding }, [
      embedding.buffer,
      dinoEmbedding.buffer,
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

// Serialize requests so we never run two model passes at once.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<Request>) => {
  const data = e.data;
  if (data?.type === 'embed') chain = chain.then(() => handleImage(data));
  else if (data?.type === 'embedText') chain = chain.then(() => handleText(data));
  // Preload both image models ahead of the first embed.
  else if (data?.type === 'warm')
    chain = chain.then(() =>
      Promise.all([getVision(), getDino()]).then(
        () => undefined,
        () => undefined,
      ),
    );
};
