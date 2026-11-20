// Curated visual-character vocabulary for the look end of the slider: tone, light, texture,
// composition and mood. It describes how a group looks rather than what it shows. Each word
// is embedded as "a {word} photo", which reads naturally for adjectives, where the subject
// template "a photo of {word}" did not. After editing, re-embed with
// npm run build:vocab-vectors.

export const STYLE_TEMPLATE = (word: string) => `a ${word} photo`;

export const STYLE_VOCABULARY: string[] = [
  // Color and tone
  'warm', 'cool', 'muted', 'saturated', 'vibrant', 'monochrome', 'pastel', 'earthy', 'neutral',
  'colorful', 'black and white', 'desaturated', 'faded', 'washed out', 'neon', 'jewel toned',
  'sepia', 'high contrast', 'low contrast',
  // Light
  'bright', 'airy', 'dark', 'moody', 'sunlit', 'shadowy', 'hazy', 'golden hour', 'overcast',
  'backlit', 'candlelit', 'dim', 'glowing', 'harshly lit', 'softly lit', 'flash lit',
  'night time',
  // Texture and finish
  'grainy', 'matte', 'glossy', 'textured', 'smooth', 'crisp', 'blurry', 'reflective',
  'metallic', 'raw', 'polished', 'handmade', 'weathered',
  // Form and composition
  'minimal', 'geometric', 'symmetrical', 'asymmetrical', 'organic', 'busy', 'sparse',
  'cluttered', 'layered', 'flat lay', 'close up', 'wide angle', 'aerial', 'overhead',
  'low angle', 'centered', 'off center', 'candid', 'posed', 'motion blurred',
  // Era and mood
  'vintage', 'retro', 'modern', 'futuristic', 'editorial', 'cinematic', 'documentary',
  'dreamy', 'bold', 'delicate', 'rustic', 'sleek', 'ornate', 'industrial', 'brutalist',
  'playful', 'elegant', 'cozy', 'lively', 'quiet', 'intimate', 'crowded', 'empty',
  'lush', 'serene', 'gritty', 'luxurious',
];
