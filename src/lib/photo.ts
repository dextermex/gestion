/**
 * Photographs taken on a phone are 10 to 25 MB apiece and go up one by one
 * on mobile data. Before they leave the device they are brought down to a
 * size that keeps every detail an inventory or a listing needs (2048 px on
 * the longest edge, JPEG at 85%). The orientation the camera recorded is
 * applied, so a portrait shot stays a portrait. Anything that is not an
 * image, is already small, or cannot be decoded here goes up unchanged.
 */

/** The longest edge a photograph keeps, in px. */
export const PHOTO_MAX_EDGE = 2048;
/** Below this size a photograph is sent as it is (bytes). */
export const PHOTO_SMALL_ENOUGH = 1024 * 1024;
export const PHOTO_QUALITY = 0.85;

/** The size `width` x `height` takes once its longest edge is at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (!(longest > maxEdge) || width <= 0 || height <= 0) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), scaled: true };
}

/** The file's name with a .jpg extension, once it has been re-encoded. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return `${base || "photo"}.jpg`;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // An option the browser does not know, or a format it cannot decode this way: the element below.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("undecodable"));
    };
    img.src = url;
  });
}

function sizeOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return "naturalWidth" in source ? { width: source.naturalWidth, height: source.naturalHeight } : { width: source.width, height: source.height };
}

async function encode(source: ImageBitmap | HTMLImageElement, width: number, height: number, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * The photograph ready to upload: resized and re-encoded when that makes it
 * smaller, otherwise the file as chosen.
 */
export async function shrinkPhoto(
  file: File,
  { maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY, smallEnough = PHOTO_SMALL_ENOUGH }: { maxEdge?: number; quality?: number; smallEnough?: number } = {},
): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= smallEnough) return file;
  try {
    const source = await decode(file);
    const { width, height } = sizeOf(source);
    const fit = fitWithin(width, height, maxEdge);
    // Already small enough and already a JPEG: re-encoding would only lose quality.
    if (!fit.scaled && file.type === "image/jpeg") return file;
    const blob = await encode(source, fit.width, fit.height, quality);
    if ("close" in source) source.close();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Every file through `shrinkPhoto`, in order. */
export function shrinkPhotos(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => shrinkPhoto(f)));
}
