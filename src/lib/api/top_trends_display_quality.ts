export interface TopTrendDisplayKeyword {
  readonly keyword: string;
  readonly keyword_id: string;
  readonly rank: number;
  readonly score_recency: number;
  readonly score_velocity: number;
  readonly score_authority: number;
  readonly score_engagement: number;
  readonly score_internal: number;
  readonly summary_short: string;
  readonly summary_short_en: string;
  readonly top_source_url: string | null;
  readonly top_source_domain: string | null;
  readonly is_manual?: boolean;
}

const TOP10_COMPAT_LIMIT = 10;
const structuredReleasePattern =
  /(?:^|[\s/@])(?:v?\d+\.\d+(?:\.\d+)?|canary|alpha|beta|rc|preview|12b|70b|405b)(?:$|[\s.@-])/i;
const developerPackagePattern = /(?:^|[\s/])(?:npm|sdk|cli|api|repo|github|vercel\/ai|claude-code)(?:$|[\s/@.-])/i;

export function isTop20LightweightGuardEnabled(): boolean {
  return process.env.PIPELINE_TOP20_LIGHTWEIGHT_GUARD_ENABLED === "1";
}

export function selectTopTrendDisplayKeywords<T extends TopTrendDisplayKeyword>(
  keywords: readonly T[],
  limit: number,
  guardEnabled: boolean
): T[] {
  if (!guardEnabled || limit <= TOP10_COMPAT_LIMIT) {
    return keywords.slice(0, limit);
  }

  const visible: T[] = [];
  for (const keyword of keywords) {
    if (visible.length >= limit) {
      break;
    }
    if (keyword.rank <= TOP10_COMPAT_LIMIT || isDisplayEligibleKeyword(keyword)) {
      visible.push(keyword);
    }
  }
  return visible;
}

function isDisplayEligibleKeyword(keyword: TopTrendDisplayKeyword): boolean {
  if (keyword.is_manual === true || hasSourceEvidence(keyword) || hasSummaryEvidence(keyword)) {
    return true;
  }

  return hasStructuredReleaseEvidence(keyword) || hasStrongScoreEvidence(keyword);
}

function hasSourceEvidence(keyword: TopTrendDisplayKeyword): boolean {
  return keyword.top_source_url !== null && keyword.top_source_url.trim().length > 0;
}

function hasSummaryEvidence(keyword: TopTrendDisplayKeyword): boolean {
  return (
    keyword.summary_short.trim().length > 0 ||
    keyword.summary_short_en.trim().length > 0
  );
}

function hasStructuredReleaseEvidence(keyword: TopTrendDisplayKeyword): boolean {
  const text = `${keyword.keyword} ${keyword.top_source_domain ?? ""}`;
  return (
    structuredReleasePattern.test(text) &&
    (developerPackagePattern.test(text) || keyword.score_authority >= 0.45)
  );
}

function hasStrongScoreEvidence(keyword: TopTrendDisplayKeyword): boolean {
  const engagement = keyword.score_engagement + keyword.score_internal;
  return (
    keyword.score_recency >= 0.65 &&
    keyword.score_velocity >= 0.35 &&
    (keyword.score_authority >= 0.45 || engagement >= 0.35)
  );
}
