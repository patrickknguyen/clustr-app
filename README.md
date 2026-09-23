# clustr

A browser-based prototype that sorts a moodboard into labeled groups. A slider blends
grouping by subject, using CLIP, with grouping by look, using DINOv2, so the user can find
the grouping that fits their board. Everything runs in the browser, with no server and no
API keys.

**[Live demo](https://patrickknguyen.github.io/clustr-app/)** · **[Case study](https://patrickknguyen.github.io/clustr/)**

https://github.com/user-attachments/assets/913bbfb0-6999-43e5-b779-1f5e3a4423af

## Why

My moodboards get messy quickly. I can often feel a direction forming but find it hard to
put into words. Clustr uses computer vision to bring those patterns to the surface while
keeping the experience playful. It is designed for suggestion rather than certainty: the
labels offer words to react to, and the final call stays with the user.

## Using it

1. Open the demo and pick a sample board: **summer**, **architecture** or **design**. Or
   drop in your own images.
2. **Library** shows the board as a photo grid. **Map** animates the same thumbnails into
   groups, each with a floating label of one to three tags.
3. Drag the slider from **semantic** to **aesthetic**. The groups rearrange, and the labels
   shift from subject words like "building" to style words like "warm" or "geometric."
4. Hover a label to focus its group. The tags drift toward the images each one describes
   best.

## How it works

```
add images  ->  Web Worker embeds each image with CLIP and DINOv2
open Map    ->  blend the two embeddings by the slider value α
            ->  UMAP to 2D, aligned to the pure-CLIP layout so the map doesn't spin
            ->  k-means on the map, with k chosen by silhouette score
            ->  label each group from CLIP against a subject and a style vocabulary
```

### Key decisions

**Label what's distinctive, not what's shared.** Images on the same board already share
themes, so those words name the board and are kept off the group labels. Each group's tags
are ranked by how much better a word fits that group than it fits the board on average,
similar in spirit to TF-IDF:

$$
\mathrm{score}(w, c) = s(w, c) - \frac{1}{K}\sum_{k=1}^{K} s(w, k)
\quad \text{where } s(w, c) \geq 0.9 \cdot \max_{w'} s(w', c)
$$

*s* is the cosine similarity between word *w* and the center of cluster *c*. Pushed too far,
distinctiveness rewards obscure words that barely fit, so a word must also come within 90%
of the cluster's best match.

**Don't force groups that aren't there.** Clustr tries two to seven groups and keeps the
split with the best silhouette score. If no split is clean enough, the board stays as one
group.

**Let the user choose the lens.** There is no single correct way to group a moodboard, so
the slider blends the two models instead of picking one. Their distances don't share a
scale, so DINO is rescaled once per board to match CLIP's spread:

$$
d_{\alpha} = \sqrt{(1 - \alpha)\, d_{\text{CLIP}}^{2} + \alpha\, \lambda^{2} d_{\text{DINO}}^{2}}
\quad \text{where } \lambda = \frac{\sigma(d_{\text{CLIP}})}{\sigma(d_{\text{DINO}})}
$$

*d* is the distance between two images and *σ* is the standard deviation of those distances.
Labels always come from CLIP, since DINO has no text encoder.

**Keep the map steady.** UMAP leaves a layout's rotation and reflection arbitrary, so
re-projecting as the slider moves would make the map spin and flip. Each new layout is
aligned to the pure-CLIP layout, and UMAP and k-means are seeded, so a board always looks
the same at the same slider value.

**Run entirely in the browser.** Both models run on WebGPU with a WASM fallback, and load
during idle time after the page opens so they are usually ready by the first upload. The
vocabularies and sample boards ship with precomputed embeddings. The app deploys as a
static site and costs nothing to run.

### Vocabulary

- **Subject words:** the 400 most frequent keywords in the
  [Unsplash Dataset](https://github.com/unsplash/datasets) Lite, past which the tags got too
  noisy.
- **Style words:** Unsplash's tags are almost all nouns, which leaves the aesthetic end of the
  slider with little to say. A matching list of 66 visual adjectives fills that gap, and the
  labels shift toward it as α moves toward DINO.

## Limitations and next steps

This is a proof of concept. Its biggest limit is vocabulary: Unsplash's tags were the most
accessible option, not the most useful, and a richer vocabulary would make the labels far more
meaningful. Beyond that, I'd add color as a third way to group, and let the user nudge the
number of groups directly.

## Running locally

Requires Node 20 or later. CI builds with Node 22.

```bash
npm install
npm run dev      # dev server
npm run build    # type-check and production build
npm run lint     # oxlint
```

The vocabulary and sample boards are built offline, and their output is committed:

```bash
npm run build:vocab -- <path-to-unsplash-lite> 400   # writes src/lib/vocabulary.ts
npm run build:samples                                # samples-src/<board>/ to public/samples/
```

Pushing to `main` builds and deploys the demo to GitHub Pages.

## Project structure

```
src/
  workers/embed.worker.ts   CLIP and DINOv2 inference, off the main thread
  lib/blend.ts              per-board DINO rescaling and the α blend
  lib/cluster.ts            seeded UMAP projection
  lib/align.ts              keeps each new layout aligned to the CLIP layout
  lib/labeling.ts           k selection, board name and distinctive tags
  components/Stage.tsx      the Library and Map views and their animation
  store.ts                  app state and the embedding pipeline
scripts/                    offline vocabulary and sample-board builds
```

## Built with

React, TypeScript and Vite, with
[Transformers.js](https://github.com/huggingface/transformers.js) running
`Xenova/clip-vit-base-patch32` and `Xenova/dinov2-small`,
[umap-js](https://github.com/PAIR-code/umap-js) for the map,
[Motion](https://motion.dev) for animation and Zustand for state. Sample images and
keywords come from [Unsplash](https://unsplash.com).
