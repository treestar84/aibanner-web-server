import { NextRequest, NextResponse } from "next/server";
import { getContentLikeCount, likeContent, unlikeContent } from "@/lib/db/queries";
import {
  getViewerHash,
  isValidLikeContentType,
  LIKE_CONTENT_ID_MAX_LENGTH,
} from "@/lib/content-like-tracking";

export const runtime = "nodejs";
export const revalidate = 0;

// 클라이언트는 로컬 토글 후의 "최종 상태"를 그대로 보낸다 (liked: true/false).
// 서버가 델타를 계산하는 대신 원하는 최종 상태를 받는 편이, 네트워크 재시도로
// 같은 요청이 중복 도착해도 멱등하게 처리된다.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const contentType = typeof body?.contentType === "string" ? body.contentType : "";
    const contentId =
      typeof body?.contentId === "string" ? body.contentId.trim() : "";
    const liked = body?.liked;

    if (!isValidLikeContentType(contentType)) {
      return NextResponse.json({ error: "Invalid contentType" }, { status: 400 });
    }
    if (!contentId || contentId.length > LIKE_CONTENT_ID_MAX_LENGTH) {
      return NextResponse.json({ error: "Invalid contentId" }, { status: 400 });
    }
    if (typeof liked !== "boolean") {
      return NextResponse.json({ error: "liked must be a boolean" }, { status: 400 });
    }

    const viewerHash = getViewerHash(req);
    // HMAC 비밀키가 없으면 익명 요청을 신뢰할 근거가 없다 — 조회수 트래킹과
    // 동일한 원칙으로, 집계를 조작 가능한 상태로 두느니 그냥 집계를 건너뛴다.
    if (!viewerHash) {
      const likeCount = await getContentLikeCount(contentType, contentId);
      return NextResponse.json({ ok: true, liked, likeCount, trackingEnabled: false });
    }

    const result = liked
      ? await likeContent(contentType, contentId, viewerHash)
      : await unlikeContent(contentType, contentId, viewerHash);

    return NextResponse.json({
      ok: true,
      liked: result.liked,
      likeCount: result.likeCount,
      trackingEnabled: true,
    });
  } catch (err) {
    console.error("[/api/v1/content-likes][POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
