# clustr

Drop a pile of moodboard images onto a canvas, open the **Clusters** view, and
watch them animate into semantically grouped clusters — each labeled with a few
auto-generated tags. Everything runs **in the browser**: no backend, no API keys,
no cost.

> Proof-of-concept. Intentionally low-fidelity (wireframe styling) — the point is
> the clustering, not the chrome.

## What it does

1. Add images (drag-and-drop or file picker). Each is embedded with **CLIP** in a
   background Web Worker as it arrives.
2. Switch between two views:
   - **Library** — an iPhone-style photo grid.
   - **Clusters** — a 2D map where visually/semantically similar images sit
     together, produced by projecting the CLIP embeddings with **UMAP**.
3. Open the **Clusters** view and the same thumbnails morph from their grid slots
   into the map (the view itself is the trigger — no separate button). Each group
   gets a floating **label** of 1–3 tags, chosen zero-shot from a data-driven
   vocabulary using CLIP's text encoder.
4. The board's **shared theme** (the word common to *every* cluster) surfaces as a
   faint watermark at the center and auto-names the board — while the per-cluster
   labels stay distinctive.
5. **Hover a label** to focus its cluster: the other images dim, and the tags
   split apart and float to the images each one best describes.

## Key design decisions

**100% client-side, $0 to run.** CLIP runs in the browser via
[`@huggingface/transformers`](https://github.com/huggingface/transformers.js) on
WebGPU (falling back to WASM). Model weights stream from the Hugging Face CDN and
cache locally. There is no server, database, or paid API — the app deploys as a
static site and costs nothing to host. This constraint shaped everything below.

**CLIP for embeddings.** CLIP is image–text aligned, which gives us two things
from one model: image similarity for clustering, and — because the text encoder
lives in the same space — zero-shot text **labels** without an LLM or backend.

**UMAP for the map.** Embeddings are projected to 2D with UMAP. The projection is
**seeded** (a fixed PRNG), so the same images always produce the same layout
instead of a randomly rotated/mirrored one each run. Raw UMAP coordinates are
stored and mapped to pixels in the view layer, so resizing never re-runs the
projection.

**One set of elements that morphs.** Library and Clusters are not separate views —
they are the same DOM elements re-positioned. Pressing Cluster animates each
thumbnail from its grid slot to its cluster position (via
[Motion](https://motion.dev)), rather than fading one view out and another in.

**Data-driven vocabulary.** The label candidate set isn't hand-picked — it's the
top ~400 most frequent descriptive keywords in the [Unsplash
Dataset](https://github.com/unsplash/datasets) (Lite), with platform/format meta-tags
and taxonomic noise filtered out (`scripts/build-vocab.ts`). N=400 was chosen by
sweeping the count and observing where label coherence peaked — bigger vocabularies
(e.g. 2000) drag in plausible-but-odd words like "clown" that CLIP genuinely matches.
CLIP itself is open-vocabulary; this is just the curated candidate set we rank against.

**Robust, quality-gated labeling.** Labels come from a discrete grouping laid over
the continuous map, but we avoid forcing structure that isn't there:
- `k` is chosen by **silhouette score**, not a fixed formula.
- If no split is well-separated enough, the board collapses to a **single
  board-level label** instead of inventing regional ones.
- Tags are ranked by **distinctiveness** (a word's similarity to a cluster minus
  its mean similarity across all clusters), so a term that is close to
  *everything* — e.g. "summer" on a summer board — never dominates every label.
- Each label carries a **variable 1–3 tags**: crisp groups get one word, mixed
  groups get more, and near-synonyms are de-duplicated (so a label reads
  "ocean · beach · swimming," never the redundant "ocean · sea").
- The **board-level theme** is found separately, by the word with the highest
  *minimum* similarity across all clusters — i.e. the one that applies to
  *everything* ("summer"). This is the complement of distinctiveness: it promotes
  the universal signal the per-cluster labels deliberately suppress.
- Labels are anchored at each group's **centroid** so they distribute across the
  whole map.

**Text labels over LLM captions.** An LLM would produce more evocative captions,
but it needs a backend and breaks the $0 / private-by-default model. Zero-shot
CLIP tagging keeps everything local.

## How it works

```
add image ─▶ Web Worker: CLIP vision encoder ─▶ embedding (cached per image)
                                                      │
open Clusters ──▶ UMAP → 2D map ──┬─▶ seeded k-means (silhouette-picked k)
                                  │        │
                                  │        └─▶ per-group CLIP centroid
                                  │                 │  cosine vs. vocabulary
                                  │                 ▼  (text encoder, cached)
                                  │            distinctive top 1–3 tags
                                  └─▶ Motion: thumbnails morph grid → map + labels
```

## Getting started

Requires Node 20+.

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run lint     # oxlint
```

The app opens on a bundled **sample board** in the Library; open the **Clusters**
view to watch it group — instantly, since the embeddings are precomputed. Drop your
own images (or press **Add images**) to make a board of your own — the first time
you do, the CLIP image weights download and cache; the label vocabulary is
precomputed and shipped, so the text model never loads at all.

### Sample boards & vocabulary

Both are built offline. The label vocabulary is derived from the Unsplash Dataset:

```bash
npm run build:vocab -- <path-to-unsplash-lite-dataset> 400   # writes src/lib/vocabulary.ts
npm run build:samples                                        # processes samples-src/<name>/
```

`build:samples` downscales/compresses each image into `public/samples/<name>/`,
precomputes its CLIP embedding, and writes `public/vocab.json` (the vocabulary's
text vectors). The result is that a sample board loads and clusters **instantly** —
no model download, no embedding wait. `samples-src/` is git-ignored (large); only
the small processed assets are shipped.

## Pinterest scraper (optional helper)

A dev-time script downloads real reference images to test with. It is **not** part
of the app (a scraper can't run in the browser). See
[`scripts/README.md`](scripts/README.md).

```bash
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
npm run scrape -- "https://www.pinterest.com/user/board/" -n 40
```

Then drag the downloaded folder's images into the app.

## Project structure

```
src/
  workers/embed.worker.ts   CLIP vision + text encoders (off the main thread)
  lib/
    embedder.ts             worker manager (image + text embedding)
    cluster.ts              UMAP projection (seeded)
    labeling.ts             k-means + silhouette + distinctiveness tagging
    layout.ts               map projection → viewport + collision relaxation
    vocabulary.ts           label vocabulary (generated from the Unsplash Dataset)
    rng.ts                  seeded PRNG
  components/Stage.tsx       the morphing canvas + floating labels
  store.ts                  app state (zustand)
scripts/                     offline tools: sample/vocab builders + Pinterest scraper
```

## Tech stack

React · TypeScript · Vite · [Motion](https://motion.dev) ·
[zustand](https://github.com/pmndrs/zustand) ·
[transformers.js](https://github.com/huggingface/transformers.js) (CLIP) ·
[umap-js](https://github.com/PAIR-code/umap-js)

## Limitations

- **HEIC images** can't be decoded in-browser and are skipped (marked as errors).
- The vocabulary is **fixed and Unsplash-derived**, so it leans toward photography/
  nature terms; an off-vocabulary theme gets an approximate tag.
- Tuned for boards of roughly **50–150 images**.

## Roadmap

- A "cluster by look" toggle (DINOv3) and a CLIP ↔ visual ↔ color blend slider.
- A dominant-color feature for palette-aware clustering and labels.
- Label collision avoidance; a granularity control for cluster count.
