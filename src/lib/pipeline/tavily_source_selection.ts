import type { TavilySource } from "@/lib/pipeline/tavily";
import { classifySourceCategory } from "@/lib/pipeline/source_category";
import {
  evaluateSourceQuality,
  SOURCE_RELEVANCE_THRESHOLD,
} from "@/lib/pipeline/source_quality";

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

export function filterRelevantSources(
  sources: readonly TavilySource[],
  keyword: string
): TavilySource[] {
  if (tokenize(keyword).length <= 1) {
    return [...sources];
  }

  return sources.filter((source) =>
    evaluateSourceQuality({
      keyword,
      title: source.title,
      snippet: source.snippet,
      url: source.url,
      domain: source.domain,
      provider: source.provider,
      category: source.type,
    }).passesThreshold
  );
}

const RECENT_SOURCE_WINDOW_MS = 72 * 60 * 60 * 1000;

export function scoreSourcePriority(source: TavilySource, keyword: string): number {
  const quality = evaluateSourceQuality({
    keyword,
    title: source.title,
    snippet: source.snippet,
    url: source.url,
    domain: source.domain,
    provider: source.provider,
    category: source.type,
  });
  let priorityScore = quality.relevanceScore;

  if (quality.relevanceScore >= SOURCE_RELEVANCE_THRESHOLD && isKoreanPreferredSource(source)) {
    const isSocial = classifySourceCategory(source) === "social";
    priorityScore += isSocial ? 0.6 : 1.2;
  }
  if (quality.relevanceScore >= SOURCE_RELEVANCE_THRESHOLD && source.provider === "naver") {
    priorityScore += 0.2;
  }
  if (source.provider === "origin") {
    priorityScore += 2.0;
  }
  if (isWithinRecentWindow(source.publishedAt)) {
    priorityScore += 0.3;
  }

  return priorityScore;
}

function isWithinRecentWindow(publishedAt: string | null | undefined): boolean {
  if (!publishedAt) return false;
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= RECENT_SOURCE_WINDOW_MS;
}

export function isKoreanPreferredSource(
  source: Pick<TavilySource, "domain" | "title" | "snippet" | "provider">
): boolean {
  if (source.provider === "naver") {
    return true;
  }

  const domain = normalizeDomain(source.domain);
  if (domain.endsWith(".kr")) {
    return true;
  }
  for (const knownDomain of KOREAN_SOURCE_DOMAINS) {
    if (domain === knownDomain || domain.endsWith(`.${knownDomain}`)) {
      return true;
    }
  }

  return hasKoreanText(source.title) || hasKoreanText(source.snippet);
}

function tokenize(value: string): readonly string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_\-·/@:]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && token !== "ai");
}

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function hasKoreanText(value: string | null | undefined): boolean {
  return /[가-힣]/.test(value ?? "");
}
