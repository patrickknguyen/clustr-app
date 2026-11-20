/**
 * Re-embed the label vocabularies without touching the sample boards. Writes
 * public/vocab.json and public/style-vocab.json, the text vectors the app ranks groups
 * against, so the browser never has to load CLIP's text model.
 *
 * Run with: npm run build:vocab-vectors
 */
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { writeFile } from 'node:fs/promises';
import { VOCABULARY, LABEL_TEMPLATE } from '../src/lib/vocabulary';
import { STYLE_VOCABULARY, STYLE_TEMPLATE } from '../src/lib/style-vocabulary';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

function l2(v: Float32Array): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}

async function main() {
  console.log('loading the CLIP text model…');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });

  // Rounded to 4 decimals, which is plenty for cosine ranking and keeps the files small.
  async function embed(words: string[], template: (w: string) => string) {
    const inputs = tokenizer(words.map(template), { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    const [, dim] = text_embeds.dims as [number, number];
    const flat = text_embeds.data as Float32Array;
    return words.map((word, i) => ({
      word,
      embedding: l2(flat.slice(i * dim, (i + 1) * dim)).map((x) => Math.round(x * 1e4) / 1e4),
    }));
  }

  await writeFile('public/vocab.json', JSON.stringify(await embed(VOCABULARY, LABEL_TEMPLATE)));
  await writeFile(
    'public/style-vocab.json',
    JSON.stringify(await embed(STYLE_VOCABULARY, STYLE_TEMPLATE)),
  );
  console.log(`done: ${VOCABULARY.length} subject words, ${STYLE_VOCABULARY.length} style words.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
