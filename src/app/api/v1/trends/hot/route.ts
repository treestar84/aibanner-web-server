import { NextRequest, NextResponse } from "next/server";
import {
  getActiveManualKeywordIds,
  getHotKeywords,
  getLatestSnapshot,
  getLatestSnapshotWithKeywords,
} from "@/lib/db/queries";
import { normalizePrimaryType } from "@/lib/pipeline/source_category";
import { buildSnsDeeplinks } from "@/lib/pipeline/sns_deeplinks";
import { parsePipelineMode } from "@/lib/pipeline/mode";
import { buildFreshness, cacheControlByMode } from "@/lib/api/freshness";
import { filterActiveSnapshotKeywords } from "@/lib/manual-keywords";

export const runtime = "nodejs";
export const revalidate = 0;

function parsePositiveInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 10, 1, 50);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";
    const lifecycleDays = parsePositiveInt(
      process.env.RETENTION_KEYWORD_VIEW_DAYS,
      3,
      1,
      30
    );
    const requestedMode = parsePipelineMode(url.searchParams.get("mode"), "realtime");

    const snapshot =
      (await getLatestSnapshotWithKeywords(requestedMode)) ??
      (await getLatestSnapshot(requestedMode));
    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot available yet" },
        { status: 404 }
      );
    }

    const keywords = await getHotKeywords(
      lifecycleDays,
      Math.max(limit * 4, 100),
      10,
      snapshot.pipeline_mode
    );
    const activeManualKeywordIds = await getActiveManualKeywordIds(snapshot.pipeline_mode);
    const visibleKeywords = filterActiveSnapshotKeywords(
      keywords,
      activeManualKeywordIds
    ).slice(0, limit);

    return NextResponse.json(
      {
        mode: snapshot.pipeline_mode,
        freshness: buildFreshness(snapshot.updated_at_utc),
        snapshotId: snapshot.snapshot_id,
        updatedAt: snapshot.updated_at_utc,
        lifecycleDays,
        topRankLimit: 10,
        items: visibleKeywords.map((kw) => {
          const localizedKeyword = lang === "en"
            ? (kw.keyword_en || kw.keyword)
            : (kw.keyword_ko || kw.keyword);
          const localizedTopTitle = lang === "en"
            ? (kw.top_source_title_en || kw.top_source_title)
            : (kw.top_source_title_ko || kw.top_source_title);

          return {
            id: kw.keyword_id,
            keyword: localizedKeyword,
            rank: kw.rank,
            deltaRank: kw.delta_rank,
            isNew: kw.is_new,
            viewCount: kw.view_count,
            lastViewedAt: kw.last_viewed_at,
            summaryShort: lang === "en" ? (kw.summary_short_en || kw.summary_short) : kw.summary_short,
            primaryType: normalizePrimaryType(kw.primary_type, {
              type: kw.primary_type,
              domain: kw.top_source_domain,
              url: kw.top_source_url,
              title: localizedTopTitle,
            }),
            topSource: kw.top_source_url
              ? {
                  title: localizedTopTitle,
                  url: kw.top_source_url,
                  source: kw.top_source_domain,
                  snippet: null,
                  imageUrl: kw.top_source_image_url ?? "/images/default-thumbnail.png",
                }
              : null,
            // Phase 3 §5.2.6: SNS·검색 deeplink 4종 (keyword detail 응답과 동일 shape)
            deeplinks: buildSnsDeeplinks(localizedKeyword),
          };
        }),
      },
      {
        headers: {
          "Cache-Control": cacheControlByMode(snapshot.pipeline_mode, "hot"),
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/trends/hot]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
