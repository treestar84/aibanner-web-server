import { NextRequest, NextResponse } from "next/server";
import {
  getLatestSnapshot,
  getSourcesByKeyword,
  searchKeywordsByText,
  incrementSearchCount,
} from "@/lib/db/queries";
import { collectSources } from "@/lib/pipeline/tavily";

export const runtime = "nodejs";
export const revalidate = 0;

type SourceType = "news" | "web" | "video" | "image";
const SOURCE_TYPES: SourceType[] = ["news", "web", "video", "image"];

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
    const snapshot = await getLatestSnapshot();

    if (snapshot) {
      // Try DB search first
      const keywords = await searchKeywordsByText(q.trim(), snapshot.snapshot_id);
      if (keywords.length > 0) {
        const keyword = keywords[0];
        const sources = await getSourcesByKeyword(snapshot.snapshot_id, keyword.keyword_id);
        if (sources.length === 0) {
          // Lightweight 키워드(11~20)일 수 있으므로 Tavily fallback으로 계속 진행
          console.log(`[search] No stored sources for "${keyword.keyword}", fallback to Tavily`);
        } else {
          const grouped = SOURCE_TYPES.map((type) => ({
            type,
            items: sources
              .filter((s) => s.type === type)
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

          return NextResponse.json({
            id: keyword.keyword_id,
            keyword: keyword.keyword,
            updatedAt: keyword.created_at,
            summary: lang === "en"
              ? (keyword.summary_short_en || keyword.summary_short)
              : keyword.summary_short,
            bullets: [],
            sources: grouped,
          });
        }
      }
    }

    // Tavily fallback
    const tavilySources = await collectSources(q.trim());

    const grouped = SOURCE_TYPES.map((type) => ({
      type,
      items: (tavilySources[type] ?? [])
        .slice(0, limit)
        .map((s) => ({
          title: s.title,
          url: s.url,
          source: s.domain,
          publishedAt: s.publishedAt,
          snippet: s.snippet ?? "",
          imageUrl: s.imageUrl ?? "",
        })),
    })).filter((g) => g.items.length > 0);

    const firstSnippet =
      tavilySources.news[0]?.snippet ??
      tavilySources.web[0]?.snippet ??
      "";

    return NextResponse.json({
      id: `search_${normalized}`,
      keyword: q.trim(),
      updatedAt: new Date().toISOString(),
      summary: firstSnippet,
      bullets: [],
      sources: grouped,
    });
  } catch (err) {
    console.error("[/api/v1/search]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
