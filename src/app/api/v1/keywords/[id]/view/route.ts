import { NextRequest, NextResponse } from "next/server";
import {
  getKeywordInLatestSnapshot,
  incrementKeywordViewCount,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 0;

// 인스턴스 내 IP+keyword 중복 집계 방지 (Redis 없이 서버리스 환경 대응)
const VIEW_COOLDOWN_MS = 60 * 60 * 1000; // 1시간
const MAX_DEDUP_ENTRIES = 5_000;
const viewCooldown = new Map<string, number>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function isDuplicate(key: string): boolean {
  const last = viewCooldown.get(key);
  return !!last && Date.now() - last < VIEW_COOLDOWN_MS;
}

function recordView(key: string): void {
  if (viewCooldown.size >= MAX_DEDUP_ENTRIES) {
    const now = Date.now();
    for (const [k, ts] of viewCooldown) {
      if (now - ts >= VIEW_COOLDOWN_MS) viewCooldown.delete(k);
    }
  }
  viewCooldown.set(key, Date.now());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const keywordId = id.trim();

    if (!keywordId) {
      return NextResponse.json({ error: "keyword id is required" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const dedupKey = `${ip}:${keywordId}`;

    if (isDuplicate(dedupKey)) {
      return NextResponse.json({ ok: true, keywordId, skipped: true });
    }

    const keyword = await getKeywordInLatestSnapshot(keywordId);
    if (!keyword) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    await incrementKeywordViewCount(keyword.keyword_id);
    recordView(dedupKey);
    return NextResponse.json({ ok: true, keywordId: keyword.keyword_id });
  } catch (err) {
    console.error("[/api/v1/keywords/:id/view]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
