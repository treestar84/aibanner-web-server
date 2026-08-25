import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    // @vercel/blob은 BLOB_READ_WRITE_TOKEN(고정 토큰)이 없으면
    // VERCEL_OIDC_TOKEN + BLOB_STORE_ID(OIDC 인증)로 자동 폴백한다.
    // 둘 중 하나도 없으면 미구성으로 판단해 503으로 막는다.
    const hasStaticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    const hasOidcConfig = Boolean(process.env.BLOB_STORE_ID);
    if (!hasStaticToken && !hasOidcConfig) {
      return NextResponse.json(
        { error: "Image storage is not configured on server" },
        { status: 503 },
      );
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Image exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit` },
        { status: 400 },
      );
    }

    const extension = file.type.split("/")[1] ?? "jpg";
    const blob = await put(
      `expert-picks/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
      file,
      { access: "public", contentType: file.type },
    );

    return NextResponse.json({ ok: true, imageUrl: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/upload-image][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
