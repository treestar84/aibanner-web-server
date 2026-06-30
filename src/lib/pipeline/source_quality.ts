export type SourceQualityReason =
  | "exact_phrase"
  | "title_anchor"
  | "snippet_anchor"
  | "url_anchor"
  | "domain_anchor"
  | "korean_context_anchor"
  | "suspicious_domain"
  | "missing_anchor";

export interface SourceQualityInput {
  readonly keyword: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly url: string;
  readonly domain: string | null;
  readonly provider?: "tavily" | "naver";
  readonly category?: "news" | "social" | "data" | "web" | "video" | "image";
}

export interface SourceQualityResult {
  readonly relevanceScore: number;
  readonly passesThreshold: boolean;
  readonly reasons: readonly SourceQualityReason[];
}

export const SOURCE_RELEVANCE_THRESHOLD = 0.45;

const SUSPICIOUS_DOMAINS = new Set([
  "finance.yahoo.com",
  "ca.finance.yahoo.com",
  "sports.chosun.com",
  "newstown.co.kr",
  "eurovision.tv",
]);

export function evaluateSourceQuality(input: SourceQualityInput): SourceQualityResult {
  const keywordSurface = normalizeSurface(input.keyword);
  const keywordTokens = tokenize(input.keyword);
  const titleSurface = normalizeSurface(input.title);
  const snippetSurface = normalizeSurface(input.snippet ?? "");
  const urlSurface = normalizeSurface(input.url);
  const domainSurface = normalizeHost(input.domain);
  const reasons: SourceQualityReason[] = [];
  let score = 0;

  if (keywordSurface.length > 0 && `${titleSurface} ${snippetSurface}`.includes(keywordSurface)) {
    score += 0.62;
    reasons.push("exact_phrase");
  }

  const titleRatio = tokenMatchRatio(keywordTokens, titleSurface);
  const snippetRatio = tokenMatchRatio(keywordTokens, snippetSurface);
  if (titleRatio >= 0.5) {
    score += 0.28 * titleRatio;
    reasons.push("title_anchor");
  }
  if (snippetRatio >= 0.5) {
    score += 0.18 * snippetRatio;
    reasons.push("snippet_anchor");
  }
  if (tokenMatchRatio(keywordTokens, urlSurface) >= 0.5) {
    score += 0.16;
    reasons.push("url_anchor");
  }
  if (tokenMatchRatio(keywordTokens, domainSurface) >= 0.5) {
    score += 0.12;
    reasons.push("domain_anchor");
  }
  if (hasKoreanText(input.title) || hasKoreanText(input.snippet)) {
    const contextText = `${titleSurface} ${snippetSurface}`;
    if (contextText.includes("claude code") || contextText.includes("codex")) {
      score += 0.12;
      reasons.push("korean_context_anchor");
    }
  }
  if (isSuspiciousDomain(domainSurface)) {
    score -= 0.22;
    reasons.push("suspicious_domain");
  }
  if (!hasAnchorReason(reasons)) {
    reasons.push("missing_anchor");
  }

  const relevanceScore = clamp01(score);
  return {
    relevanceScore,
    passesThreshold: relevanceScore >= SOURCE_RELEVANCE_THRESHOLD,
    reasons,
  };
}

function normalizeSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[_\-·/@:]+/g, " ")
    .replace(/[“”"'`~!#$%^&*()+=[\]{}|\\;<>?,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHost(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/^www\./, "");
}

function tokenize(value: string): readonly string[] {
  return normalizeSurface(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && token !== "ai");
}

function tokenMatchRatio(tokens: readonly string[], haystack: string): number {
  if (tokens.length === 0 || haystack.length === 0) {
    return 0;
  }
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched / tokens.length;
}

function hasKoreanText(value: string | null | undefined): boolean {
  return /[가-힣]/.test(value ?? "");
}

function isSuspiciousDomain(domain: string): boolean {
  for (const suspiciousDomain of SUSPICIOUS_DOMAINS) {
    if (domain === suspiciousDomain || domain.endsWith(`.${suspiciousDomain}`)) {
      return true;
    }
  }
  return false;
}

function hasAnchorReason(reasons: readonly SourceQualityReason[]): boolean {
  return reasons.some(
    (reason) =>
      reason === "exact_phrase" ||
      reason === "title_anchor" ||
      reason === "snippet_anchor" ||
      reason === "url_anchor" ||
      reason === "domain_anchor" ||
      reason === "korean_context_anchor"
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
