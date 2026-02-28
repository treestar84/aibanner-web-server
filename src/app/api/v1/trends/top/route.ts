import { NextRequest, NextResponse } from "next/server";
import { getLatestSnapshot, getTopKeywords } from "@/lib/db/queries";
import { normalizePrimaryType } from "@/lib/pipeline/source_category";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(50, Math.max(1, parseInt(limitParam ?? "10", 10)));
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";

    const snapshot = await getLatestSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot available yet" },
        { status: 404 }
      );
    }

    const keywords = await getTopKeywords(snapshot.snapshot_id, limit);

    return NextResponse.json(
      {
        snapshotId: snapshot.snapshot_id,
        updatedAt: snapshot.updated_at_utc,
        nextUpdateAt: snapshot.next_update_at_utc,
        items: keywords.map((kw) => ({
          primaryType: normalizePrimaryType(kw.primary_type, {
            type: kw.primary_type,
            domain: kw.top_source_domain,
            url: kw.top_source_url,
            title: kw.top_source_title,
          }),
          id: kw.keyword_id,
          rank: kw.rank,
          keyword: kw.keyword,
          deltaRank: kw.delta_rank,
          isNew: kw.is_new,
          score: kw.score,
          scoreBreakdown: {
            recency: kw.score_recency,
            frequency: kw.score_frequency,
            authority: kw.score_authority,
            internal: kw.score_internal,
          },
          summaryShort: lang === "en" ? kw.summary_short_en || kw.summary_short : kw.summary_short,
          topSource: kw.top_source_url
            ? {
                title: kw.top_source_title,
                url: kw.top_source_url,
                source: kw.top_source_domain,
                snippet: null,
                imageUrl: kw.top_source_image_url ?? "/images/default-thumbnail.png",
              }
            : null,
        })),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/trends/top]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
