export type ImageStatus = 'pending' | 'ready' | 'error';

export interface ImageItem {
  id: string;
  url: string; // object URL (uploads) or served path (samples)
  file?: File; // absent for sample images (they arrive pre-embedded)
  embedding?: Float32Array; // L2-normalized CLIP image embedding (semantic)
  dinoEmbedding?: Float32Array; // L2-normalized DINOv2 CLS embedding (visual/by-look)
  status: ImageStatus;
}

export interface Point {
  x: number;
  y: number;
}

export type Mode = 'grid' | 'cluster';

export interface TagWeight {
  id: string;
  w: number;
}

export interface ClusterTag {
  word: string;
  /** Softmax weights over member images; the chip sits at their weighted centroid. */
  weights: TagWeight[];
}

export interface Cluster {
  memberIds: string[];
  tags: ClusterTag[];
}
