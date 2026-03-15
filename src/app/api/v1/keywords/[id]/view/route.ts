import { NextResponse } from "next/server";
import {
  getKeywordInLatestSnapshot,
  incrementKeywordViewCount,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const keywordId = id.trim();

    if (!keywordId) {
      return NextResponse.json({ error: "keyword id is required" }, { status: 400 });
    }

    // 현재/최근 스냅샷에 존재하는 키워드만 집계 대상
    const keyword = await getKeywordInLatestSnapshot(keywordId);
    if (!keyword) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    await incrementKeywordViewCount(keyword.keyword_id);
    return NextResponse.json({ ok: true, keywordId: keyword.keyword_id });
  } catch (err) {
    console.error("[/api/v1/keywords/:id/view]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
