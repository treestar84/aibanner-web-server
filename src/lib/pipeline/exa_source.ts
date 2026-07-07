// Exa Search API 연동 — Tavily 검색 실패/빈 결과 시 폴백으로 사용한다.

export interface ExaResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string | null;
}

interface ExaApiResultItem {
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string;
}

interface ExaApiResponse {
  results?: ExaApiResultItem[];
}

/**
 * EXA_API_KEY가 설정되어 있을 때만 Exa 폴백을 활성화한다.
 */
export function isExaEnabled(): boolean {
  return Boolean(process.env.EXA_API_KEY && process.env.EXA_API_KEY.trim() !== "");
}

function resolveStartPublishedDate(timeRange: "day" | "week" | "month"): string {
  const daysAgo = timeRange === "day" ? 1 : timeRange === "week" ? 7 : 30;
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

/**
 * Exa Search API로 검색한다. 실패(비-2xx, 예외) 시 항상 빈 배열을 반환하며 절대 throw하지 않는다.
 * 참고: Exa는 Tavily와 달리 site: 연산자를 엄격히 지원하지 않지만, 쿼리에 그대로 포함해도
 * soft signal로 동작하므로 별도 가공 없이 그대로 전달한다.
 */
export async function exaSearch(
  query: string,
  options: { maxResults: number; timeRange: "day" | "week" | "month" }
): Promise<ExaResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: options.maxResults,
        type: "auto",
        contents: {
          text: { maxCharacters: 1500 },
        },
        startPublishedDate: resolveStartPublishedDate(options.timeRange),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[exa] search failed: HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as ExaApiResponse;
    const results = data.results ?? [];

    return results
      .filter((r) => Boolean(r.url))
      .map((r) => ({
        title: r.title ?? "",
        url: r.url as string,
        content: r.text ?? "",
        publishedDate: r.publishedDate ?? null,
      }));
  } catch (error) {
    console.warn(`[exa] search failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
