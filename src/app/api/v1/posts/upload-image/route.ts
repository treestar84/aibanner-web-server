import { NextRequest, NextResponse } from "next/server";
import { requirePostToken } from "@/lib/post-token-auth";
import { uploadImage } from "@/lib/image-upload";
export const runtime = "nodejs";
export const revalidate = 0;
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;
    return await uploadImage(req, "community-posts");
  } catch {
    return NextResponse.json(
      { error: "Image upload temporarily unavailable" },
      { status: 503 },
    );
  }
}
