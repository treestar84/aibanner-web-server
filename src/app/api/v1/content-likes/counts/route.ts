import { NextRequest, NextResponse } from "next/server";
import { getContentLikeCounts } from "@/lib/db/queries";
import {
  isValidLikeContentType,
  LIKE_COUNTS_MAX_BATCH_IDS,
} from "@/lib/content-like-tracking";

// content-like-tracking.ts가 node:crypto(getViewerHash)를 쓰기 때문에 edge
// 런타임에서는 그 모듈을 임포트하는 것만으로 빌드가 깨진다 — 이 라우트가
// getViewerHash를 직접 쓰지 않아도 마찬가지라 nodejs로 통일한다.
export const runtime = "nodejs";
export const revalidate = 0;

// 지금은 어떤 화면도 이 엔드포인트를 호출하지 않는다 — 좋아요 집계를 나중에
// 화면에 노출할 때(예: "N명이 좋아요") 쓸 수 있도록 미리 열어둔 조회 경로다.
export async function GET(req: NextRequest) {
  try {
    const contentType = req.nextUrl.searchParams.get("contentType") ?? "";
    if (!isValidLikeContentType(contentType)) {
      return NextResponse.json({ error: "Invalid contentType" }, { status: 400 });
    }

    const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
    const ids = [
      ...new Set(
        idsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ].slice(0, LIKE_COUNTS_MAX_BATCH_IDS);

    if (ids.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const counts = await getContentLikeCounts(contentType, ids);
    return NextResponse.json({ counts });
  } catch (err) {
    console.error("[/api/v1/content-likes/counts][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
