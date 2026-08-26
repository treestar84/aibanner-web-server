import { NextRequest, NextResponse } from "next/server";
import { listExpertPicks, getExpertPickMaxUpdatedAt } from "@/lib/db/queries";

export const runtime = "edge";
export const revalidate = 3600;

// 모바일 앱 기본값 — 둘러보기 목록이 과거 글까지 무한정 쌓이지 않도록
// "최신 15개"로 고정한다. 과거 글을 더 보고 싶으면 웹(/expert-picks)을
// 안내한다 (거긴 최대 50개까지 보여준다).
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(req: NextRequest) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

    const ifModifiedSince = req.headers.get("if-modified-since");
    const maxUpdatedAt = await getExpertPickMaxUpdatedAt();

    if (ifModifiedSince && maxUpdatedAt) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const serverDate = new Date(maxUpdatedAt).getTime();
      if (!isNaN(clientDate) && serverDate <= clientDate) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const rows = await listExpertPicks(true, limit);
    const items = rows.map((r) => ({
      id: r.id,
      title: lang === "en" ? r.title_en || r.title_ko : r.title_ko,
      body: lang === "en" ? r.body_en || r.body_ko : r.body_ko,
      imageUrl: r.image_url,
      linkUrl: r.link_url,
      linkDomain: r.link_domain,
      authorLabel: r.author_label,
      viewCount: r.view_count,
      createdAt: r.created_at,
    }));

    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    };
    if (maxUpdatedAt) headers["Last-Modified"] = new Date(maxUpdatedAt).toUTCString();

    return NextResponse.json({ items, updatedAt: maxUpdatedAt }, { headers });
  } catch (err) {
    console.error("[/api/v1/expert-picks][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
