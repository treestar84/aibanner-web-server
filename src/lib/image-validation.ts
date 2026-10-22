import sharp from "sharp";
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
export class InvalidImage extends Error {}

export async function normalizeImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_FILE_SIZE_BYTES)
    throw new InvalidImage("Image size limit");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 20_000_000,
      animated: true,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 60
    )
      throw new InvalidImage("Unsupported image");
    // Re-encoding verifies actual pixels and removes EXIF (including location).
    const result = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 3 })
      .toBuffer();
    if (result.length > MAX_FILE_SIZE_BYTES)
      throw new InvalidImage("Image size limit");
    return result;
  } catch {
    throw new InvalidImage("Invalid or oversized image");
  }
}
