// Exhibition flag: add ?gallery to the URL for the Design Gallery build. It runs an
// attract loop on a big screen, watches a folder for AirDropped photos, and resets
// itself when visitors walk away. Add &sample=<board> to start from a sample board.
const params =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

export const GALLERY = params?.has('gallery') ?? false;
export const GALLERY_SAMPLE = params?.get('sample') ?? null;

// scripts/airdrop-relay.py serves tonight's photos here. The port must match the script.
export const RELAY_URL = 'http://127.0.0.1:4180';

// The pinned board that collects tonight's photos.
export const GALLERY_BOARD_NAME = 'Design Gallery 2.0';

// Sample boards pinned beside tonight's board, in this order, with fixed names. Each loads
// its photos the first time it's opened.
export const GALLERY_SAMPLES = [
  { sample: 'summer', name: 'Summer' },
  { sample: 'architecture', name: 'Architecture' },
  { sample: 'design-tina-kavcic', name: 'Design' },
];

// Copy on the invitation card. Edit here before the event.
export const GALLERY_COPY = {
  // Must match this Mac's name exactly as guests see it in AirDrop.
  airdropName: "Pat's MacBook Pro",
  url: 'patrickknguyen.github.io/clustr',
};
