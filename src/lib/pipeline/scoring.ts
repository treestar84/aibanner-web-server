import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";

// ─── Weights (PRD §4.3) ───────────────────────────────────────────────────────

interface ScoreWeights {
  recency: number;
  frequency: number;
  authority: number;
  velocity: number;
  internal: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  // recency/velocity를 동시에 반영해 "막 뜨는 키워드" 감도를 높인다.
  recency: 0.45,
  frequency: 0.18,
  authority: 0.17,
  velocity: 0.20,
  internal: 0.00,
};

export interface ScoringProfile {
  recencyHalfLifeHours: number;
  velocityRecentWindowHours: number;
  velocityBaselineWindowHours: number;
  weights: ScoreWeights;
}

const DEFAULT_PROFILE: ScoringProfile = {
  recencyHalfLifeHours: 36,
  velocityRecentWindowHours: 6,
  velocityBaselineWindowHours: 18,
  weights: DEFAULT_WEIGHTS,
};

// ─── Tier authority score ─────────────────────────────────────────────────────

const TIER_AUTHORITY: Record<string, number> = {
  P0_CURATED: 1.0,
  P1_CONTEXT: 0.6,
  P2_RAW: 0.3,
  COMMUNITY: 0.2,
};

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  recency: number;
  frequency: number;
  authority: number;
  velocity: number;
  internal: number;
  total: number;
}

function resolveWeights(custom?: Partial<ScoreWeights>): ScoreWeights {
  return {
    recency: custom?.recency ?? DEFAULT_WEIGHTS.recency,
    frequency: custom?.frequency ?? DEFAULT_WEIGHTS.frequency,
    authority: custom?.authority ?? DEFAULT_WEIGHTS.authority,
    velocity: custom?.velocity ?? DEFAULT_WEIGHTS.velocity,
    internal: custom?.internal ?? DEFAULT_WEIGHTS.internal,
  };
}

function calculateVelocityScore(
  keyword: NormalizedKeyword,
  sourceItems: RssItem[],
  nowMs: number,
  profile: ScoringProfile
): number {
  if (sourceItems.length === 0 || keyword.candidates.matchedItems.size === 0) {
    return 0;
  }

  const recentWindow = Math.max(1, profile.velocityRecentWindowHours);
  const baselineWindow = Math.max(1, profile.velocityBaselineWindowHours);
  const totalWindow = recentWindow + baselineWindow;
  let recentCount = 0;
  let baselineCount = 0;

  for (const idx of keyword.candidates.matchedItems) {
    const item = sourceItems[idx];
    if (!item) continue;

    const ageHours = (nowMs - item.publishedAt.getTime()) / (1000 * 60 * 60);
    if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > totalWindow) continue;

    if (ageHours <= recentWindow) {
      recentCount += 1;
    } else {
      baselineCount += 1;
    }
  }

  // 기준 구간(6~24h)을 recent 구간 길이(0~6h)로 환산해 비교한다.
  const baselinePerRecentWindow = baselineCount / (baselineWindow / recentWindow);
  const ratio = (recentCount + 1) / (baselinePerRecentWindow + 1);
  const centered = (ratio - 1) / (ratio + 1); // -1..1
  return Math.max(0, Math.min(1, centered));
}

export function calculateScore(
  keyword: NormalizedKeyword,
  options?: {
    profile?: Partial<Omit<ScoringProfile, "weights">> & {
      weights?: Partial<ScoreWeights>;
    };
    sourceItems?: RssItem[];
    now?: Date;
  }
): ScoreBreakdown {
  const profile: ScoringProfile = {
    recencyHalfLifeHours:
      options?.profile?.recencyHalfLifeHours ?? DEFAULT_PROFILE.recencyHalfLifeHours,
    velocityRecentWindowHours:
      options?.profile?.velocityRecentWindowHours ??
      DEFAULT_PROFILE.velocityRecentWindowHours,
    velocityBaselineWindowHours:
      options?.profile?.velocityBaselineWindowHours ??
      DEFAULT_PROFILE.velocityBaselineWindowHours,
    weights: resolveWeights(options?.profile?.weights ?? DEFAULT_PROFILE.weights),
  };
  const weights = profile.weights;
  const now = (options?.now ?? new Date()).getTime();
  const ageMs = now - keyword.candidates.latestAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const safeHalfLife = Math.max(1, profile.recencyHalfLifeHours);

  // recency: 실제 반감기 공식(half-life)
  const recency = Math.pow(0.5, ageHours / safeHalfLife);

  // frequency: 유니크 도메인 수 기반 (최대 10개 도메인 → 1.0)
  const frequency = Math.min(1, keyword.candidates.domains.size / 10);

  // authority: tier 기반
  const authority = TIER_AUTHORITY[keyword.candidates.tier] ?? 0.2;

  const velocity = calculateVelocityScore(
    keyword,
    options?.sourceItems ?? [],
    now,
    profile
  );

  // internal: 기본 0 (운영자 부스팅/블랙리스트로 추후 조정)
  const internal = 0;

  const total =
    recency * weights.recency +
    frequency * weights.frequency +
    authority * weights.authority +
    velocity * weights.velocity +
    internal * weights.internal;

  return {
    recency: parseFloat(recency.toFixed(4)),
    frequency: parseFloat(frequency.toFixed(4)),
    authority: parseFloat(authority.toFixed(4)),
    velocity: parseFloat(velocity.toFixed(4)),
    internal,
    total: parseFloat(total.toFixed(4)),
  };
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export interface RankedKeyword {
  keyword: NormalizedKeyword;
  score: ScoreBreakdown;
  rank: number;
}

export function rankKeywords(
  keywords: NormalizedKeyword[],
  options?: {
    limit?: number;
    profile?: Partial<Omit<ScoringProfile, "weights">> & {
      weights?: Partial<ScoreWeights>;
    };
    sourceItems?: RssItem[];
    now?: Date;
  }
): RankedKeyword[] {
  const limit = options?.limit ?? 10;
  const scored = keywords.map((kw) => ({
    keyword: kw,
    score: calculateScore(kw, {
      profile: options?.profile,
      sourceItems: options?.sourceItems,
      now: options?.now,
    }),
  }));

  scored.sort((a, b) => b.score.total - a.score.total);

  return scored.slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

// ─── Delta rank calculation (PRD §4.4) ───────────────────────────────────────

export function calculateDeltaRanks(
  ranked: RankedKeyword[],
  prevRanks: Map<string, number>
): Array<RankedKeyword & { deltaRank: number; isNew: boolean }> {
  return ranked.map((item) => {
    const prevRank = prevRanks.get(item.keyword.keywordId);
    const isNew = prevRank === undefined;
    const deltaRank = isNew ? 0 : prevRank - item.rank; // 상승이면 +

    return { ...item, deltaRank, isNew };
  });
}
