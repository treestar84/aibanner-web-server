import { publicHttpUrl, safeFetchBytes } from "../safe-fetch";
import type { RssItem } from "./rss";

const PAGE_URL = "https://report.koraia.org/info";
const API_ORIGIN = "https://kydkwdwtsqsjxasirxoi.supabase.co";
const MAX_ITEMS = 200;

export function parseKoraiaItems(data: unknown, cutoff: Date, now = new Date()): RssItem[] {
  if (!Array.isArray(data)) throw new Error("Invalid KORAIA response");
  const seen = new Set<string>();
  const items: RssItem[] = [];
  for (const row of data.slice(0, MAX_ITEMS)) {
    if (!row || typeof row !== "object") continue;
    const { id, title, url, created_at: createdAt } = row;
    if (!Number.isSafeInteger(id) || id <= 0 || typeof title !== "string" ||
        typeof url !== "string" || typeof createdAt !== "string") continue;
    try { publicHttpUrl(url); } catch { continue; }
    const publishedAt = new Date(createdAt);
    if (!Number.isFinite(publishedAt.getTime()) || publishedAt <= cutoff ||
        publishedAt.getTime() > now.getTime() + 5 * 60_000) continue;
    // created_at is the aggregation time, never evidence of the original publication time.
    const headline = title.split(/\s+\|\s+/)[0].trim().slice(0, 500);
    const key = headline.normalize("NFKC").toLowerCase();
    if (!headline || seen.has(key)) continue;
    seen.add(key);
    items.push({
      title: headline,
      link: `${PAGE_URL}#article-${id}`,
      publishedAt,
      summary: "",
      sourceDomain: "report.koraia.org",
      feedTitle: "KORAIA AI 뉴스",
      tier: "P2_RAW",
      lang: "ko",
      keywordBoostSource: "koraia",
    });
  }
  return items;
}

/** Two bounded reads per run; only the browser's public publishable key is used. */
export async function collectKoraiaItems(
  windowHours = 72,
  fetcher: typeof safeFetchBytes = safeFetchBytes,
  now = new Date()
): Promise<RssItem[]> {
  try {
    const cutoff = new Date(now.getTime() - windowHours * 3_600_000);
    const page = await fetcher(PAGE_URL, { maxBytes: 128 * 1024, timeoutMs: 8000, contentTypes: ["text/html"] });
    const html = page.bytes.toString("utf8");
    const origin = html.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const key = html.match(/SUPABASE_ANON_KEY\s*=\s*['"](sb_publishable_[A-Za-z0-9_-]+)['"]/)?.[1];
    if (origin !== API_ORIGIN || !key) throw new Error("KORAIA public API configuration changed");
    const endpoint = new URL("/rest/v1/ai_info", API_ORIGIN);
    endpoint.search = new URLSearchParams({
      select: "id,title,url,created_at",
      order: "created_at.desc,id.desc",
      created_at: `gte.${cutoff.toISOString()}`,
      limit: String(MAX_ITEMS),
    }).toString();
    const response = await fetcher(endpoint.href, {
      headers: { apikey: key }, maxBytes: 1024 * 1024, timeoutMs: 8000,
      contentTypes: ["application/json"],
    });
    const items = parseKoraiaItems(JSON.parse(response.bytes.toString("utf8")), cutoff, now);
    console.log(`[koraia] Collected ${items.length} keyword-boost items (cap=${MAX_ITEMS})`);
    return items;
  } catch (error) {
    console.warn(`[koraia] Collection skipped: ${(error as Error).message}`);
    return [];
  }
}
