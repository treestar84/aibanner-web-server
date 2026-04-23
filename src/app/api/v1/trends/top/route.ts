import { NextRequest, NextResponse } from "next/server";
import {
  getActiveManualKeywordIds,
  getLatestSnapshotWithKeywords,
  getTopKeywords,
} from "@/lib/db/queries";
import { normalizePrimaryType } from "@/lib/pipeline/source_category";
import { buildSnsDeeplinks } from "@/lib/pipeline/sns_deeplinks";
import { parsePipelineMode } from "@/lib/pipeline/mode";
import { buildFreshness, cacheControlByMode } from "@/lib/api/freshness";
import { filterActiveSnapshotKeywords } from "@/lib/manual-keywords";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(50, Math.max(1, parseInt(limitParam ?? "10", 10)));
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";
    const requestedMode = parsePipelineMode(url.searchParams.get("mode"), "realtime");

    const snapshot =
      (await getLatestSnapshotWithKeywords(requestedMode)) ??
      (await getLatestSnapshotWithKeywords());
    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot available yet" },
        { status: 404 }
      );
    }

    const keywords = await getTopKeywords(
      snapshot.snapshot_id,
      Math.max(limit * 4, 100)
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
        nextUpdateAt: snapshot.next_update_at_utc,
        items: visibleKeywords.map((kw) => {
          const localizedKeyword = lang === "en"
            ? (kw.keyword_en || kw.keyword)
            : (kw.keyword_ko || kw.keyword);
          const localizedTopTitle = lang === "en"
            ? (kw.top_source_title_en || kw.top_source_title)
            : (kw.top_source_title_ko || kw.top_source_title);

          return {
            primaryType: normalizePrimaryType(kw.primary_type, {
              type: kw.primary_type,
              domain: kw.top_source_domain,
              url: kw.top_source_url,
              title: localizedTopTitle,
            }),
            id: kw.keyword_id,
            rank: kw.rank,
            keyword: localizedKeyword,
            deltaRank: kw.delta_rank,
            isNew: kw.is_new,
            score: kw.score,
            scoreBreakdown: {
              recency: kw.score_recency,
              frequency: kw.score_frequency,
              authority: kw.score_authority,
              velocity: kw.score_velocity,
              engagement: kw.score_engagement ?? 0,
              internal: kw.score_internal,
            },
            summaryShort: lang === "en" ? kw.summary_short_en || kw.summary_short : kw.summary_short,
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
          "Cache-Control": cacheControlByMode(snapshot.pipeline_mode, "top"),
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/trends/top]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
