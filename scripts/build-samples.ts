/**
 * Offline build step for the in-app sample boards.
 *
 * For each folder in `samples-src/<board>/`:
 *   - downscale + compress every image → `public/samples/<board>/`
 *   - precompute its CLIP image embedding
 *   - write `public/samples/<board>/board.json`
 * Plus `public/samples/index.json` (the board list) and `public/vocab.json`
 * (the label vocabulary's text vectors, so the app never loads the text model).
 *
 * Run with: npm run build:samples
 */
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import sharp from 'sharp';
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { VOCABULARY, LABEL_TEMPLATE } from '../src/lib/vocabulary';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const SRC = 'samples-src';
const OUT = 'public/samples';
const MAX_DIM = 512;
const QUALITY = 72;

function l2(v: Float32Array): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}

async function main() {
  console.log('loading CLIP…');
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });

  const ORDER = ['summer', 'architecture', 'design-tina-kavcic'];
  const rank = (b: string) => {
    const i = ORDER.indexOf(b);
    return i < 0 ? ORDER.length : i;
  };
  const boards = (await readdir(SRC, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const index: { id: string; count: number }[] = [];

  for (const board of boards) {
    const srcDir = join(SRC, board);
    const outDir = join(OUT, board);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const files = (await readdir(srcDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    const images: { file: string; embedding: number[] }[] = [];

    for (const file of files) {
      const outName = parse(file).name + '.jpg';
      const buf = await sharp(join(srcDir, file))
        .rotate()
        .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY })
        .toBuffer();
      await writeFile(join(outDir, outName), buf);

      const image = await RawImage.read(join(outDir, outName));
      const inputs = await processor(image);
      const { image_embeds } = await vision(inputs);
      images.push({ file: outName, embedding: l2(image_embeds.data as Float32Array) });
      process.stdout.write(`\r  ${board}: ${images.length}/${files.length}`);
    }
    process.stdout.write('\n');

    await writeFile(join(outDir, 'board.json'), JSON.stringify({ images }));
    index.push({ id: board, count: images.length });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'index.json'), JSON.stringify(index));

  console.log('embedding vocabulary…');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });
  const inputs = tokenizer(VOCABULARY.map(LABEL_TEMPLATE), { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  const [, dim] = text_embeds.dims as [number, number];
  const flat = text_embeds.data as Float32Array;
  // Round to 4 decimals — plenty for cosine ranking, keeps the shipped file small.
  const vocab = VOCABULARY.map((word, i) => ({
    word,
    embedding: l2(flat.slice(i * dim, (i + 1) * dim)).map((x) => Math.round(x * 1e4) / 1e4),
  }));
  await writeFile('public/vocab.json', JSON.stringify(vocab));

  console.log(`done — ${boards.length} board(s), ${VOCABULARY.length} vocab words.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
