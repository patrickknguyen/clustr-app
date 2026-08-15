/**
 * Offline build step for the in-app sample boards.
 *
 * For each folder in `samples-src/<board>/`:
 *   - downscale + compress every image → `public/samples/<board>/` (idempotent: reuses
 *     an already-processed image if it exists, so re-runs don't churn committed jpgs)
 *   - precompute its CLIP (semantic) + DINOv2 (visual) image embeddings
 *   - write `public/samples/<board>/board.json`
 * Plus `public/samples/index.json` (the board list) and `public/vocab.json`
 * (the label vocabulary's text vectors, so the app never loads the text model).
 *
 * Run with: npm run build:samples
 */
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import sharp from 'sharp';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { VOCABULARY, LABEL_TEMPLATE } from '../src/lib/vocabulary';
import { STYLE_VOCABULARY } from '../src/lib/style-vocabulary';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DINO_ID = 'Xenova/dinov2-small'; // ViT-S/14, 384-D CLS token — visual "by look" features
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

// Rounded L2 for the larger DINO vectors — 4 decimals is plenty for cosine ranking
// and roughly halves the shipped board.json size.
function l2round(v: Float32Array): number[] {
  return l2(v).map((x) => Math.round(x * 1e4) / 1e4);
}

// DINOv2 has no projection head; the global image feature is the CLS token
// (first position of last_hidden_state).
function dinoEmbed(out: { last_hidden_state: { data: Float32Array; dims: number[] } }): number[] {
  const t = out.last_hidden_state;
  const dim = t.dims[t.dims.length - 1];
  return l2round((t.data as Float32Array).slice(0, dim));
}

async function main() {
  console.log('loading CLIP + DINOv2…');
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });
  const dinoProcessor = await AutoProcessor.from_pretrained(DINO_ID);
  const dinoModel = await AutoModel.from_pretrained(DINO_ID, { dtype: 'fp32' });

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
    await mkdir(outDir, { recursive: true });

    const files = (await readdir(srcDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    const images: { file: string; embedding: number[]; dino: number[] }[] = [];

    for (const file of files) {
      const outName = parse(file).name + '.jpg';
      const outPath = join(outDir, outName);
      // Idempotent: reuse the already-downscaled image if present (avoids re-encoding
      // 120 committed jpgs — and the git churn — when re-running just to add vectors).
      if (!existsSync(outPath)) {
        const buf = await sharp(join(srcDir, file))
          .rotate()
          .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: QUALITY })
          .toBuffer();
        await writeFile(outPath, buf);
      }

      const image = await RawImage.read(outPath);
      const { image_embeds } = await vision(await processor(image));
      const dino = dinoEmbed(await dinoModel(await dinoProcessor(image)));
      images.push({ file: outName, embedding: l2(image_embeds.data as Float32Array), dino });
      process.stdout.write(`\r  ${board}: ${images.length}/${files.length}`);
    }
    process.stdout.write('\n');

    await writeFile(join(outDir, 'board.json'), JSON.stringify({ images }));
    index.push({ id: board, count: images.length });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'index.json'), JSON.stringify(index));

  console.log('embedding vocabularies (subject + style)…');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });
  // Embed a word list through the CLIP text tower; rounds to 4 decimals (plenty for
  // cosine ranking, keeps the shipped file small).
  async function embedVocab(words: string[]) {
    const inputs = tokenizer(words.map(LABEL_TEMPLATE), { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    const [, dim] = text_embeds.dims as [number, number];
    const flat = text_embeds.data as Float32Array;
    return words.map((word, i) => ({
      word,
      embedding: l2(flat.slice(i * dim, (i + 1) * dim)).map((x) => Math.round(x * 1e4) / 1e4),
    }));
  }
  await writeFile('public/vocab.json', JSON.stringify(await embedVocab(VOCABULARY)));
  await writeFile('public/style-vocab.json', JSON.stringify(await embedVocab(STYLE_VOCABULARY)));

  console.log(`done — ${boards.length} board(s), ${VOCABULARY.length} subject + ${STYLE_VOCABULARY.length} style words.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
