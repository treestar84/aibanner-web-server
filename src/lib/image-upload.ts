import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, normalizeImage } from "./image-validation";
import { readLimitedBody } from "./safe-fetch";

type UploadStorage = {
  configured(): boolean;
  save(path: string, image: Buffer): Promise<{ url: string }>;
};
const blobStorage: UploadStorage = {
  configured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
  save: (path, image) => put(path, image, { access: "public", contentType: "image/webp" }),
};

// Authentication remains at the route boundary. No DB writes, ownership registry,
// shared budget or migration dependency are introduced by this helper.
export async function uploadImage(
  req: Request,
  prefix: "community-posts" | "expert-picks",
  storage: UploadStorage = blobStorage,
): Promise<NextResponse> {
  if (!storage.configured()) return NextResponse.json(
    { error: "Image storage is not configured on server" }, { status: 503 },
  );
  let bytes: Buffer;
  try { bytes = await readLimitedBody(req, MAX_FILE_SIZE_BYTES + 64 * 1024); }
  catch { return NextResponse.json({ error: "Image exceeds 4MB limit", code: "IMAGE_TOO_LARGE" }, { status: 413 }); }
  let image: Buffer;
  try {
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": req.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported image type", code: "INVALID_IMAGE" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) return NextResponse.json(
      { error: "Image exceeds 4MB limit", code: "IMAGE_TOO_LARGE" }, { status: 413 },
    );
    image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
  } catch { return NextResponse.json({ error: "Choose a valid JPEG, PNG, WebP or GIF under 4MB", code: "INVALID_IMAGE" }, { status: 400 }); }
  try {
    const blob = await storage.save(`${prefix}/${randomUUID()}.webp`, image);
    return NextResponse.json({ ok: true, imageUrl: blob.url });
  } catch {
    return NextResponse.json({ error: "Image upload temporarily unavailable" }, { status: 503 });
  }
}
