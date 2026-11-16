// Finder drops HEIC with an empty MIME type, and the file picker hides it behind
// image/* on Chromium. Chromium also cannot decode HEIC, so those files are
// transcoded to JPEG. Safari can paint them natively and skips the transcode.

const RASTER_EXT = /\.(avif|bmp|gif|hei[cf]|jpe?g|png|tiff?|webp)$/i;
const HEIC_EXT = /\.hei[cf]$/i;
const HEIC_MIME = /^image\/hei[cf]/i;
// Major brands at ISO-BMFF offset 8, the same set heic-to treats as HEIC/HEIF.
const HEIC_BRANDS = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']);

export function isObviousImage(file: File): boolean {
  return file.type.startsWith('image/') || RASTER_EXT.test(file.name);
}

export async function isHeic(file: Blob): Promise<boolean> {
  if (file.size < 12) return false;
  const brand = new TextDecoder()
    .decode(await file.slice(8, 12).arrayBuffer())
    .toLowerCase()
    .replace(/\0/g, '')
    .trim();
  return HEIC_BRANDS.has(brand);
}

// Keep files the picker/drop already labels as images, plus unlabeled HEIC.
export async function selectImages(files: File[]): Promise<File[]> {
  const picked: File[] = [];
  for (const file of files) {
    if (isObviousImage(file)) picked.push(file);
    else if (
      (file.type === '' || file.type === 'application/octet-stream') &&
      (await isHeic(file))
    ) {
      picked.push(file);
    }
  }
  return picked;
}

async function browserCanDecode(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const ok = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return ok;
  } catch {
    return false;
  }
}

function jpegName(name: string): string {
  if (HEIC_EXT.test(name)) return name.replace(HEIC_EXT, '.jpg');
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.jpg`;
}

// Return a file the <img> tag and the embedding worker can both decode.
export async function toDisplayableImage(file: File): Promise<File> {
  const declared = HEIC_MIME.test(file.type) || HEIC_EXT.test(file.name);
  if (!declared && !(await isHeic(file))) return file;
  if (await browserCanDecode(file)) return file;

  const { heicTo } = await import('heic-to');
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  return new File([jpeg], jpegName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
