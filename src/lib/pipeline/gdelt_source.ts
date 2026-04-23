import type { RssItem } from "./rss";
import { buildDynamicQuery } from "./dynamic_query";

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // "20240101120000" 또는 "20240101T120000Z"
  domain: string;
  language: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

// audit-A#L298-321 / Phase 1 §3.2.6: GDELT 언어 라벨을 다언어 코드로 정규화.
// "ja"/"zh"/"other"는 다운스트림이 우선 미사용이지만, 향후 Phase 2 language 축에서 활용 가능.
function mapGdeltLang(s: string | undefined): "ko" | "en" | "ja" | "zh" | "other" {
  switch ((s ?? "").toLowerCase()) {
    case "korean":
      return "ko";
    case "english":
      return "en";
    case "japanese":
      return "ja";
    case "chinese":
      return "zh";
    default:
      return "other";
  }
}

function gdeltDateFormat(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function parseGdeltDate(seendate: string): Date {
  const clean = seendate.replace(/[TZ]/g, "");
  const y = clean.slice(0, 4);
  const mo = clean.slice(4, 6);
  const d = clean.slice(6, 8);
  const h = clean.slice(8, 10);
  const mi = clean.slice(10, 12);
  const s = clean.slice(12, 14) || "00";
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

// Phase 1 §3.2.7 (PRD 2026-04-23 · audit-A#L362):
// 한국어 GDELT 결과를 별도로 1회 더 가져와 한국 사용자 카테고리 커버리지를 강화한다.
// (영문 broad 쿼리는 GDELT가 한국어 매체를 적게 포함시키는 경향이 있음.)
async function fetchGdeltOnce(
  query: string,
  windowHours: number,
  extraParams: Record<string, string> = {}
): Promise<RssItem[]> {
  const until = new Date();
  const since = new Date(until.getTime() - windowHours * 60 * 60 * 1000);

  const params = new URLSearchParams({
    query,
    mode: "artlist",
    maxrecords: "250",
    format: "json",
    startdatetime: gdeltDateFormat(since),
    enddatetime: gdeltDateFormat(until),
    ...extraParams,
  });

  const res = await fetch(
    `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data: GdeltResponse = await res.json();
  if (!data.articles) return [];

  const items: RssItem[] = [];
  for (const article of data.articles) {
    if (!article.url || !article.title) continue;
    items.push({
      title: article.title,
      link: article.url,
      publishedAt: parseGdeltDate(article.seendate),
      summary: "",
      sourceDomain:
        article.domain ||
        new URL(article.url).hostname.replace(/^www\./, ""),
      feedTitle: "GDELT",
      tier: "P1_CONTEXT" as const,
      lang: mapGdeltLang(article.language),
    });
  }
  return items;
}

export async function collectGdeltItems(windowHours = 72): Promise<RssItem[]> {
  try {
    const dynamicQuery = await buildDynamicQuery();
    const gdeltQuery = dynamicQuery
      .split(" OR ")
      .map((term) => `"${term.replace(/^"|"$/g, "").trim()}"`)
      .join(" OR ");

    const [enResult, koResult] = await Promise.allSettled([
      fetchGdeltOnce(gdeltQuery, windowHours),
      fetchGdeltOnce(gdeltQuery, windowHours, { sourcelang: "kor" }),
    ]);

    const merged: RssItem[] = [];
    const seen = new Set<string>();
    for (const result of [enResult, koResult]) {
      if (result.status !== "fulfilled") {
        console.warn("[gdelt_source] partial failure:", (result.reason as Error)?.message);
        continue;
      }
      for (const item of result.value) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        merged.push(item);
      }
    }

    console.log(`[gdelt_source] Got ${merged.length} items (en + ko merged)`);
    return merged;
  } catch (err) {
    console.warn("[gdelt_source] Failed:", (err as Error).message);
    return [];
  }
}
