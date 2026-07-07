import type { TavilySource } from "./tavily";

// ─── Env helpers ──────────────────────────────────────────────────────────────

function parsePositiveIntEnv(
  value: string | undefined,
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

const JINA_FULLTEXT_MAX_CHARS = parsePositiveIntEnv(
  process.env.JINA_FULLTEXT_MAX_CHARS,
  6000,
  1000,
  20000
);

// 렌더링이 잘 안 되거나 전문 추출 가치가 낮은 URL/도메인 패턴 (스니펫 폴백이 더 나음)
const SKIP_URL_RE = /\.pdf(?:$|\?)/i;
const SKIP_DOMAIN_RE = /(?:^|\.)(?:youtube\.com|youtu\.be|x\.com|twitter\.com)$/i;

function shouldSkipSource(source: { url: string; domain: string }): boolean {
  return SKIP_URL_RE.test(source.url) || SKIP_DOMAIN_RE.test(source.domain);
}

const MIN_FULLTEXT_CHARS = 300;

// ─── Jina Reader 단건 요청 ──────────────────────────────────────────────────────

/**
 * Jina Reader(r.jina.ai)로 URL의 전문 텍스트를 가져온다.
 * 실패(비-2xx, 빈 본문, 예외)는 항상 null을 반환하며 절대 throw하지 않는다.
 */
export async function fetchFullText(url: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-Timeout": "10",
    };
    if (process.env.JINA_API_KEY) {
      headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
    }

    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return null;

    const raw = await res.text();
    if (!raw || !raw.trim()) return null;

    const collapsed = raw.replace(/\n{3,}/g, "\n\n").trim();
    if (!collapsed) return null;

    return collapsed.slice(0, JINA_FULLTEXT_MAX_CHARS);
  } catch {
    return null;
  }
}

// ─── 상위 소스 전문 배치 수집 ────────────────────────────────────────────────────

/**
 * 상위 소스(relevance 순 정렬 가정) 중 앞에서 maxCount개에 대해 Jina Reader로 전문을 가져온다.
 * PDF/유튜브/X(트위터) 등 렌더링 품질이 낮은 URL은 건너뛴다.
 */
export async function fetchTopSourceFullTexts(
  sources: TavilySource[],
  maxCount = 2
): Promise<Array<{ url: string; domain: string; text: string }>> {
  if (process.env.JINA_READER_ENABLED === "false") return [];

  const candidates = sources
    .filter((s) => !shouldSkipSource(s))
    .slice(0, maxCount);

  if (candidates.length === 0) return [];

  const results = await Promise.allSettled(
    candidates.map(async (source) => {
      const text = await fetchFullText(source.url);
      return { url: source.url, domain: source.domain, text };
    })
  );

  const fetched: Array<{ url: string; domain: string; text: string }> = [];
  let skipped = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.text && result.value.text.length >= MIN_FULLTEXT_CHARS) {
      fetched.push({
        url: result.value.url,
        domain: result.value.domain,
        text: result.value.text,
      });
    } else {
      skipped++;
    }
  }

  console.log(
    `[jina] fetched ${fetched.length}/${candidates.length} ok, ${skipped} skipped`
  );

  return fetched;
}
