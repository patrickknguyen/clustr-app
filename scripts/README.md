# scripts/ — offline helpers

Dev-time tools that are **not** part of the browser app. They run in your
terminal; the app itself stays 100% client-side.

## build-vocab.ts

Builds the subject vocabulary from the Unsplash Dataset (Lite) keywords.

```bash
npm run build:vocab
```

## build-samples.ts

Downscales and compresses the sample boards in `samples-src/<board>/` into
`public/samples/<board>/`.

```bash
npm run build:samples
```
