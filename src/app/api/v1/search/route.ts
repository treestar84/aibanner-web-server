import { NextRequest, NextResponse } from "next/server";
import {
  getActiveManualKeywordIds,
  getLatestSnapshotWithKeywords,
  getSourcesByKeyword,
  searchKeywordsByText,
  incrementSearchCount,
} from "@/lib/db/queries";
import { collectSources } from "@/lib/pipeline/tavily";
import { classifySourceCategory } from "@/lib/pipeline/source_category";
import { buildSnsDeeplinks } from "@/lib/pipeline/sns_deeplinks";
import { batchTranslateTitles } from "@/lib/pipeline/summarize";
import { filterActiveSnapshotKeywords } from "@/lib/manual-keywords";

export const runtime = "nodejs";
export const revalidate = 0;

type SourceType = "news" | "social" | "data";
const SOURCE_TYPES: SourceType[] = ["news", "social", "data"];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";

    if (!q || q.trim() === "") {
      return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
    }

    const normalized = q.trim().toLowerCase();

    // Fire-and-forget: increment search count without blocking response
    incrementSearchCount(normalized).catch((err) =>
      console.error("[/api/v1/search] incrementSearchCount error:", err)
    );

    // Get latest snapshot
    const snapshot = await getLatestSnapshotWithKeywords();

    if (snapshot) {
      // Try DB search first
      const keywords = await searchKeywordsByText(q.trim(), snapshot.snapshot_id);
      const activeManualKeywordIds = await getActiveManualKeywordIds(snapshot.pipeline_mode);
      const visibleKeywords = filterActiveSnapshotKeywords(
        keywords,
        activeManualKeywordIds
      );

      if (visibleKeywords.length > 0) {
        const keyword = visibleKeywords[0];
        const sources = await getSourcesByKeyword(snapshot.snapshot_id, keyword.keyword_id);
        if (sources.length === 0) {
          // Lightweight 키워드(11~20)일 수 있으므로 Tavily fallback으로 계속 진행
          console.log(`[search] No stored sources for "${keyword.keyword}", fallback to Tavily`);
        } else {
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
              .slice(0, limit)
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
          return NextResponse.json({
            id: keyword.keyword_id,
            keyword: localizedKeyword,
            updatedAt: keyword.created_at,
            summary: lang === "en"
              ? (keyword.summary_short_en || keyword.summary_short)
              : keyword.summary_short,
            bullets: [],
            sources: grouped,
            deeplinks: buildSnsDeeplinks(localizedKeyword),
          });
        }
      }
    }

    // Tavily fallback
    const tavilySources = await collectSources(q.trim());
    const fallbackGroups = SOURCE_TYPES.map((type) => ({
      type,
      items: (tavilySources[type] ?? []).slice(0, limit),
    }));

    const fallbackTitles = fallbackGroups.flatMap((group) =>
      group.items.map((item) => item.title)
    );
    const translatedFallbackTitles = lang === "ko"
      ? await batchTranslateTitles(fallbackTitles, "ko")
      : fallbackTitles;
    let titleCursor = 0;

    const grouped = fallbackGroups.map((group) => ({
      type: group.type,
      items: group.items
        .map((s) => ({
          title: translatedFallbackTitles[titleCursor++] ?? s.title,
          url: s.url,
          source: s.domain,
          publishedAt: s.publishedAt,
          snippet: s.snippet ?? "",
          imageUrl: s.imageUrl ?? "",
        })),
    })).filter((g) => g.items.length > 0);

    const firstSnippet =
      tavilySources.news[0]?.snippet ??
      tavilySources.social[0]?.snippet ??
      tavilySources.data[0]?.snippet ??
      "";
    const fallbackKeyword = lang === "ko"
      ? (await batchTranslateTitles([q.trim()], "ko"))[0] ?? q.trim()
      : q.trim();

    return NextResponse.json({
      id: `search_${normalized}`,
      keyword: fallbackKeyword,
      updatedAt: new Date().toISOString(),
      summary: firstSnippet,
      bullets: [],
      sources: grouped,
      deeplinks: buildSnsDeeplinks(fallbackKeyword),
    });
  } catch (err) {
    console.error("[/api/v1/search]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
