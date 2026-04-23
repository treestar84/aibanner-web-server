import { NextRequest, NextResponse } from "next/server";
import {
  getActiveManualKeywordIds,
  getLatestSnapshotWithKeywords,
  getSnapshotById,
  getKeywordById,
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import { isManualKeywordId } from "@/lib/manual-keywords";
import { classifySourceCategory } from "@/lib/pipeline/source_category";
import { buildSnsDeeplinks } from "@/lib/pipeline/sns_deeplinks";

export const runtime = "nodejs";
export const revalidate = 0;

type SourceType = "news" | "social" | "data";
const SOURCE_TYPES: SourceType[] = ["news", "social", "data"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const snapshotIdParam = url.searchParams.get("snapshotId");
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";

    let snapshotId: string;
    let snapshotMode: "realtime";
    if (snapshotIdParam) {
      const snap = await getSnapshotById(snapshotIdParam);
      if (!snap) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }
      snapshotId = snap.snapshot_id;
      snapshotMode = snap.pipeline_mode;
    } else {
      const latest = await getLatestSnapshotWithKeywords();
      if (!latest) {
        return NextResponse.json(
          { error: "No snapshot available yet" },
          { status: 404 }
        );
      }
      snapshotId = latest.snapshot_id;
      snapshotMode = latest.pipeline_mode;
    }

    const keyword = snapshotIdParam
      ? await getKeywordById(id, snapshotId)
      : await getKeywordInLatestSnapshot(id);

    if (!keyword) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }

    if (!snapshotIdParam) {
      const keywordSnapshot = await getSnapshotById(keyword.snapshot_id);
      if (!keywordSnapshot) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }
      snapshotMode = keywordSnapshot.pipeline_mode;
    }

    if (isManualKeywordId(keyword.keyword_id)) {
      const activeManualKeywordIds = await getActiveManualKeywordIds(snapshotMode);
      if (!activeManualKeywordIds.has(keyword.keyword_id)) {
        return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
      }
    }

    const sources = await getSourcesByKeyword(keyword.snapshot_id, id);

    const categorized: Record<SourceType, typeof sources> = {
      news: [],
      social: [],
      data: [],
    };
    for (const source of sources) {
      const category = classifySourceCategory(source);
      categorized[category].push(source);
    }

    const grouped = SOURCE_TYPES.map((type) => ({
      type,
      items: categorized[type]
        .sort((a, b) => {
          const dateA = a.published_at_utc ? new Date(a.published_at_utc).getTime() : 0;
          const dateB = b.published_at_utc ? new Date(b.published_at_utc).getTime() : 0;
          return dateB - dateA;
        })
        .map((s) => ({
          title: lang === "en"
            ? (s.title_en || s.title)
            : (s.title_ko || s.title),
          url: s.url,
          source: s.domain,
          publishedAt: s.published_at_utc,
          snippet: s.snippet ?? "",
          imageUrl: s.image_url,
        })),
    })).filter((g) => g.items.length > 0);

    const localizedKeyword = lang === "en"
      ? (keyword.keyword_en || keyword.keyword)
      : (keyword.keyword_ko || keyword.keyword);

    const bulletsRaw = lang === "en"
      ? (keyword.bullets_en || keyword.bullets_ko || "[]")
      : (keyword.bullets_ko || "[]");
    let bullets: string[] = [];
    try { bullets = JSON.parse(bulletsRaw); } catch { /* empty */ }

    // Phase 3 §5.2.6 (PRD 2026-04-23): SNS·검색 deeplink 4종.
    // localizedKeyword(현재 lang에 맞춘 표기) 기준으로 검색 URL을 만든다.
    const deeplinks = buildSnsDeeplinks(localizedKeyword);

    return NextResponse.json(
      {
        snapshotId: keyword.snapshot_id,
        id: keyword.keyword_id,
        keyword: localizedKeyword,
        updatedAt: keyword.created_at,
        summary: lang === "en"
          ? (keyword.summary_short_en || keyword.summary_short)
          : keyword.summary_short,
        bullets,
        sources: grouped,
        deeplinks,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/keywords/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
