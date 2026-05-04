import { tavily } from "@tavily/core";
import { classifySourceCategory, type PrimaryType } from "./source_category";
import { collectNaverSources } from "./naver_search";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType = PrimaryType;

export interface TavilySource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  imageUrl: string | null;
  publishedAt: string | null;
  type: SourceType;
  provider?: "tavily" | "naver";
}

// ─── Client / API key pool ───────────────────────────────────────────────────

type TavilyClient = ReturnType<typeof tavily>;
type TavilyFailureKind = "quota" | "rate_limit" | "other";

interface TavilyKeyState {
  disabledUntilMs: number;
  reason: TavilyFailureKind;
  failureCount: number;
}

const tavilyKeyStates = new Map<string, TavilyKeyState>();

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveTavilyApiKeys(
  env?: { TAVILY_API_KEY?: string; TAVILY_API_KEYS?: string }
): string[] {
  const source = env ?? {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    TAVILY_API_KEYS: process.env.TAVILY_API_KEYS,
  };
  const keys = [
    ...splitEnvList(source.TAVILY_API_KEY),
    ...splitEnvList(source.TAVILY_API_KEYS),
  ];
  return Array.from(new Set(keys));
}

function maskTavilyKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function getErrorField(error: unknown, key: string): unknown {
  if (error && typeof error === "object" && key in error) {
    return (error as Record<string, unknown>)[key];
  }
  return undefined;
}

export function classifyTavilyFailure(error: unknown): TavilyFailureKind {
  const status = getErrorField(error, "status") ?? getErrorField(error, "statusCode");
  const code = String(getErrorField(error, "code") ?? "").toLowerCase();
  const name = String(getErrorField(error, "name") ?? "").toLowerCase();
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(getErrorField(error, "message") ?? error ?? "").toLowerCase();
  const combined = `${code} ${name} ${message}`;

  if (
    combined.includes("quota") ||
    combined.includes("credit") ||
    combined.includes("billing") ||
    combined.includes("insufficient") ||
    combined.includes("exceeded")
  ) {
    return "quota";
  }

  if (
    Number(status) === 429 ||
    combined.includes("rate limit") ||
    combined.includes("ratelimit") ||
    combined.includes("too many requests") ||
    combined.includes("throttle")
  ) {
    return "rate_limit";
  }

  return "other";
}

function getTavilyCooldownMs(kind: TavilyFailureKind): number {
  if (kind === "quota") {
    return TAVILY_QUOTA_COOLDOWN_HOURS * 60 * 60 * 1000;
  }
  if (kind === "rate_limit") {
    return TAVILY_RATE_LIMIT_COOLDOWN_MINUTES * 60 * 1000;
  }
  return 0;
}

function markTavilyKeyFailure(apiKey: string, kind: TavilyFailureKind): void {
  const cooldownMs = getTavilyCooldownMs(kind);
  if (cooldownMs <= 0) return;

  const previous = tavilyKeyStates.get(apiKey);
  tavilyKeyStates.set(apiKey, {
    disabledUntilMs: Date.now() + cooldownMs,
    reason: kind,
    failureCount: (previous?.failureCount ?? 0) + 1,
  });
}

function isTavilyKeyAvailable(apiKey: string): boolean {
  const state = tavilyKeyStates.get(apiKey);
  if (!state) return true;
  if (Date.now() >= state.disabledUntilMs) {
    tavilyKeyStates.delete(apiKey);
    return true;
  }
  return false;
}

function getTavilyKeyAttempts(): Array<{ apiKey: string; client: TavilyClient }> {
  const keys = resolveTavilyApiKeys().filter(isTavilyKeyAvailable);
  const limitedKeys = keys.slice(0, TAVILY_MAX_KEY_ATTEMPTS);
  return limitedKeys.map((apiKey) => ({ apiKey, client: tavily({ apiKey }) }));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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

const TAVILY_NEWS_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_NEWS_RESULTS,
  6,
  1,
  12
);
const TAVILY_SOCIAL_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_SOCIAL_RESULTS,
  6,
  1,
  12
);
const TAVILY_DATA_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_DATA_RESULTS,
  6,
  1,
  12
);
const TAVILY_BROAD_RESULTS = parsePositiveIntEnv(
  process.env.TAVILY_BROAD_RESULTS,
  8,
  1,
  16
);
const TAVILY_MAX_KEY_ATTEMPTS = parsePositiveIntEnv(
  process.env.TAVILY_MAX_KEY_ATTEMPTS,
  2,
  1,
  10
);
const TAVILY_RATE_LIMIT_COOLDOWN_MINUTES = parsePositiveIntEnv(
  process.env.TAVILY_RATE_LIMIT_COOLDOWN_MINUTES,
  15,
  1,
  1440
);
const TAVILY_QUOTA_COOLDOWN_HOURS = parsePositiveIntEnv(
  process.env.TAVILY_QUOTA_COOLDOWN_HOURS,
  24,
  1,
  744
);

async function fetchByQuery(
  query: string,
  typeHint: SourceType,
  options: { maxResults: number; timeRange: "day" | "week" | "month" }
): Promise<TavilySource[]> {
  const attempts = getTavilyKeyAttempts();
  if (attempts.length === 0) return [];

  for (const { apiKey, client } of attempts) {
    try {
      const res = await client.search(query, {
        searchDepth: "basic",
        maxResults: options.maxResults,
        timeRange: options.timeRange,
        includeImages: false,
      });
      return res.results.map((r) => ({
        title: r.title,
        url: r.url,
        domain: extractDomain(r.url),
        snippet: (r.content ?? "").slice(0, 220),
        imageUrl: null,
        publishedAt: r.publishedDate ?? null,
        type: typeHint,
        provider: "tavily",
      }));
    } catch (error) {
      const failureKind = classifyTavilyFailure(error);
      if (failureKind !== "quota" && failureKind !== "rate_limit") {
        console.warn(
          `[tavily] Search failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
      }

      markTavilyKeyFailure(apiKey, failureKind);
      console.warn(
        `[tavily] ${failureKind} for key ${maskTavilyKey(apiKey)}; trying fallback key if available.`
      );
    }
  }

  console.warn(`[tavily] All available Tavily keys failed for query "${query}".`);
  return [];
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function dedupeByUrl(sources: TavilySource[]): TavilySource[] {
  const seen = new Set<string>();
  const deduped: TavilySource[] = [];
  for (const source of sources) {
    const key = normalizeUrlKey(source.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

// ─── Main export (news/social/data 수집 + 재분류) ──────────────────────────────

/**
 * 키워드를 따옴표로 감싸 exact match를 강화합니다.
 * 이미 따옴표가 있거나 단일 단어인 경우 그대로 사용합니다.
 */
function exactMatchKeyword(keyword: string): string {
  const trimmed = keyword.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  if (!trimmed.includes(" ")) return trimmed;
  return `"${trimmed}"`;
}

export async function collectSources(
  keyword: string
): Promise<Record<SourceType, TavilySource[]>> {
  const exact = exactMatchKeyword(keyword);

  const newsQuery = `${exact} (news OR blog OR analysis OR article OR interview)`;
  const socialQuery = `${exact} (site:threads.net OR site:reddit.com OR site:dev.to OR site:x.com OR site:twitter.com OR site:facebook.com OR site:instagram.com OR site:tiktok.com OR site:clien.net)`;
  const dataQuery = `${exact} (site:youtube.com OR site:youtu.be OR site:docs.google.com OR site:drive.google.com OR site:arxiv.org OR site:openreview.net OR filetype:pdf OR dataset OR research paper OR benchmark)`;

  // 뉴스는 최근 1일 우선 수집 후, 부족하면 week로 보충
  const [naverSources, newsDay, socialSeed, dataSeed, broadSeed] = await Promise.all([
    collectNaverSources(keyword),
    fetchByQuery(newsQuery, "news", {
      maxResults: TAVILY_NEWS_RESULTS,
      timeRange: "day",
    }),
    fetchByQuery(socialQuery, "social", {
      maxResults: TAVILY_SOCIAL_RESULTS,
      timeRange: "month",
    }),
    fetchByQuery(dataQuery, "data", {
      maxResults: TAVILY_DATA_RESULTS,
      timeRange: "month",
    }),
    fetchByQuery(exact, "news", {
      maxResults: TAVILY_BROAD_RESULTS,
      timeRange: "month",
    }),
  ]);

  // day 결과가 부족하면 week로 보충
  let newsSeed = newsDay;
  if (newsDay.length < TAVILY_NEWS_RESULTS) {
    const newsWeek = await fetchByQuery(newsQuery, "news", {
      maxResults: TAVILY_NEWS_RESULTS,
      timeRange: "week",
    });
    newsSeed = dedupeByUrl([...newsDay, ...newsWeek]).slice(0, TAVILY_NEWS_RESULTS);
  }

  const merged = dedupeByUrl([
    ...naverSources.news,
    ...naverSources.social,
    ...naverSources.data,
    ...newsSeed,
    ...socialSeed,
    ...dataSeed,
    ...broadSeed,
  ]);
  const relevant = filterRelevantSources(merged, keyword);

  // 한국 자료가 있으면 먼저 노출하되, 없으면 기존 글로벌 결과를 유지합니다.
  relevant.sort((a, b) => scoreSourcePriority(b, keyword) - scoreSourcePriority(a, keyword));

  const limits: Record<SourceType, number> = {
    news: TAVILY_NEWS_RESULTS,
    social: TAVILY_SOCIAL_RESULTS,
    data: TAVILY_DATA_RESULTS,
  };
  const buckets: Record<SourceType, TavilySource[]> = {
    news: [],
    social: [],
    data: [],
  };

  for (const source of relevant) {
    const category = classifySourceCategory(source);
    if (buckets[category].length >= limits[category]) continue;
    buckets[category].push({
      ...source,
      type: category,
    });
  }

  return buckets;
}

const KOREAN_SOURCE_DOMAINS = new Set([
  "naver.com",
  "blog.naver.com",
  "cafe.naver.com",
  "news.naver.com",
  "aitimes.com",
  "etnews.com",
  "zdnet.co.kr",
  "bloter.net",
  "it.chosun.com",
  "ddaily.co.kr",
  "hankyung.com",
  "mk.co.kr",
  "chosun.com",
  "joongang.co.kr",
  "yna.co.kr",
  "news.hada.io",
  "clien.net",
  "velog.io",
  "tistory.com",
  "brunch.co.kr",
]);

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function hasKoreanText(value: string | null | undefined): boolean {
  return /[가-힣]/.test(value ?? "");
}

export function isKoreanPreferredSource(
  source: Pick<TavilySource, "domain" | "title" | "snippet" | "provider">
): boolean {
  if (source.provider === "naver") return true;

  const domain = normalizeDomain(source.domain);
  if (domain.endsWith(".kr")) return true;
  for (const knownDomain of KOREAN_SOURCE_DOMAINS) {
    if (domain === knownDomain || domain.endsWith(`.${knownDomain}`)) return true;
  }

  return hasKoreanText(source.title) || hasKoreanText(source.snippet);
}

/**
 * 수집된 소스 중 키워드와 실제 관련 없는 항목을 필터링합니다.
 * 제목+snippet에 키워드가 exact match로 포함되지 않는 경우,
 * 단어 재배열/부분 매칭으로 혼동된 결과일 가능성이 높습니다.
 */
function filterRelevantSources(
  sources: TavilySource[],
  keyword: string
): TavilySource[] {
  const kw = keyword.trim().toLowerCase();
  const kwWords = kw.split(/\s+/);

  // 단일 단어 키워드는 기존 로직으로 충분 (exact match 위험 없음)
  if (kwWords.length <= 1) return sources;

  return sources.filter((source) => {
    // Naver 검색 결과는 한국어 번역/음차 제목이 많아 영문 키워드 exact 검사를
    // 그대로 적용하면 한국 자료가 사라질 수 있습니다. 보수적으로 2건씩만
    // 수집하므로 Naver 결과는 검색 공급자의 관련도 판단을 우선 신뢰합니다.
    if (source.provider === "naver") return true;

    const text = `${source.title} ${source.snippet}`.toLowerCase();

    // 1) exact match: "mode ai"가 텍스트에 그대로 존재
    if (text.includes(kw)) return true;

    // 2) 인접 단어 매칭: 키워드 단어들이 가까이(5단어 이내) 위치
    const textWords = text.split(/\s+/);
    const firstWordIndexes: number[] = [];
    for (let i = 0; i < textWords.length; i++) {
      if (textWords[i].includes(kwWords[0])) firstWordIndexes.push(i);
    }
    for (const startIdx of firstWordIndexes) {
      const window = textWords.slice(startIdx, startIdx + kwWords.length + 3).join(" ");
      if (kwWords.every((w) => window.includes(w))) return true;
    }

    return false;
  });
}

function scoreRelevance(source: TavilySource, keyword: string): number {
  const kw = keyword.trim().toLowerCase();
  const title = source.title.toLowerCase();
  const snippet = (source.snippet ?? "").toLowerCase();

  let score = 0;
  if (title.includes(kw)) {
    score = 1.0;
  } else if (snippet.includes(kw)) {
    score = 0.4;
  } else {
    const kwWords = kw.split(/\s+/);
    const matchedInTitle = kwWords.filter((w) => title.includes(w)).length;
    score = (matchedInTitle / kwWords.length) * 0.7;
  }

  if (source.publishedAt) {
    const ageHours = (Date.now() - new Date(source.publishedAt).getTime()) / 3600000;
    if (ageHours < 24) score += 0.1;
  }

  return Math.min(1, score);
}

export function scoreSourcePriority(source: TavilySource, keyword: string): number {
  const relevanceScore = scoreRelevance(source, keyword);
  let priorityScore = relevanceScore;

  if (isKoreanPreferredSource(source)) {
    priorityScore += 1.2;
  }
  if (source.provider === "naver") {
    priorityScore += 0.2;
  }

  return priorityScore;
}
