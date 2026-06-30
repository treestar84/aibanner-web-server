export type FreshnessEvidenceReason =
  | "recent_source"
  | "structured_release"
  | "breakout_velocity"
  | "community_interest"
  | "reignition"
  | "stale_no_evidence";

export interface FreshnessEvidenceSource {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly published_at_utc: string | null;
  readonly tier: "P0_CURATED" | "P1_CONTEXT" | "P2_RAW" | "COMMUNITY";
}

export interface FreshnessEvidenceInput {
  readonly keyword: string;
  readonly score_recency: number;
  readonly score_velocity: number;
  readonly score_engagement: number;
  readonly score_authority: number;
  readonly now: Date;
  readonly sources: readonly FreshnessEvidenceSource[];
  readonly first_seen_at_utc: string | null;
  readonly previous_top10_appearances: number;
}

export interface FreshnessEvidenceResult {
  readonly eligible: boolean;
  readonly strength: number;
  readonly reasons: readonly FreshnessEvidenceReason[];
}

const RECENT_SOURCE_WINDOW_HOURS = 72;
const REIGNITION_MIN_AGE_HOURS = 72;
const STRUCTURED_RELEASE_DOMAINS = new Set([
  "github.com",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "producthunt.com",
  "openai.com",
  "anthropic.com",
  "microsoft.com",
  "googleblog.com",
  "developers.googleblog.com",
  "vercel.com",
]);
const structuredReleasePattern =
  /(?:^|[\s/@])(?:v?\d+\.\d+(?:\.\d+)?|canary|alpha|beta|rc|preview|12b|70b|405b|release|changelog)(?:$|[\s.@:-])/i;

export function evaluateFreshnessEvidence(
  input: FreshnessEvidenceInput
): FreshnessEvidenceResult {
  const reasons: FreshnessEvidenceReason[] = [];
  const recentSourceCount = input.sources.filter((source) =>
    isRecentSource(source, input.now)
  ).length;

  if (recentSourceCount > 0) {
    reasons.push("recent_source");
  }
  if (input.sources.some((source) => isStructuredReleaseSource(input.keyword, source))) {
    reasons.push("structured_release");
  }
  if (input.score_velocity >= 0.6 && input.score_recency >= 0.45) {
    reasons.push("breakout_velocity");
  }
  if (input.score_engagement >= 0.65) {
    reasons.push("community_interest");
  }
  if (isReignition(input, recentSourceCount)) {
    reasons.push("reignition");
  }
  if (reasons.length === 0) {
    reasons.push("stale_no_evidence");
  }

  return {
    eligible: !reasons.includes("stale_no_evidence"),
    strength: calculateStrength(input, reasons),
    reasons,
  };
}

function isRecentSource(source: FreshnessEvidenceSource, now: Date): boolean {
  const publishedAt = parseDate(source.published_at_utc);
  if (publishedAt === null) {
    return false;
  }
  const ageHours = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  return ageHours >= 0 && ageHours <= RECENT_SOURCE_WINDOW_HOURS;
}

function isStructuredReleaseSource(
  keyword: string,
  source: FreshnessEvidenceSource
): boolean {
  const host = normalizeHost(source.domain);
  const sourceText = `${keyword} ${source.title} ${source.url}`;
  const isTrustedDomain = STRUCTURED_RELEASE_DOMAINS.has(host);
  const isTrustedTier = source.tier === "P0_CURATED" || source.tier === "P1_CONTEXT";
  return structuredReleasePattern.test(sourceText) && (isTrustedDomain || isTrustedTier);
}

function isReignition(
  input: FreshnessEvidenceInput,
  recentSourceCount: number
): boolean {
  const firstSeenAt = parseDate(input.first_seen_at_utc);
  if (firstSeenAt === null || recentSourceCount === 0) {
    return false;
  }
  const ageHours = (input.now.getTime() - firstSeenAt.getTime()) / (1000 * 60 * 60);
  return ageHours > REIGNITION_MIN_AGE_HOURS && input.previous_top10_appearances >= 8;
}

function calculateStrength(
  input: FreshnessEvidenceInput,
  reasons: readonly FreshnessEvidenceReason[]
): number {
  if (reasons.includes("stale_no_evidence")) {
    return 0;
  }
  const sourceStrength = reasons.includes("recent_source") ? 0.72 : 0;
  const releaseStrength = reasons.includes("structured_release") ? 0.68 : 0;
  const velocityStrength = reasons.includes("breakout_velocity") ? input.score_velocity : 0;
  const communityStrength = reasons.includes("community_interest")
    ? input.score_engagement
    : 0;
  const reignitionStrength = reasons.includes("reignition") ? 0.66 : 0;
  return Math.max(
    sourceStrength,
    releaseStrength,
    velocityStrength,
    communityStrength,
    reignitionStrength,
    input.score_authority * 0.5
  );
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normalizeHost(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}
