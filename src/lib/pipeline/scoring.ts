import type { NormalizedKeyword } from "./keywords";
import type { RssItem } from "./rss";

// ─── Weights (PRD §4.3) ───────────────────────────────────────────────────────

interface ScoreWeights {
  recency: number;
  frequency: number;
  authority: number;
  velocity: number;
  engagement: number;
  internal: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  recency: 0.28,
  frequency: 0.12,
  authority: 0.08,
  velocity: 0.30,
  engagement: 0.22,
  internal: 0.00,
};

export interface ScoringProfile {
  recencyHalfLifeHours: number;
  velocityRecentWindowHours: number;
  velocityBaselineWindowHours: number;
  weights: ScoreWeights;
}

const DEFAULT_PROFILE: ScoringProfile = {
  recencyHalfLifeHours: 9,
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
  engagement: number;
  internal: number;
  total: number;
}

function resolveWeights(custom?: Partial<ScoreWeights>): ScoreWeights {
  return {
    recency: custom?.recency ?? DEFAULT_WEIGHTS.recency,
    frequency: custom?.frequency ?? DEFAULT_WEIGHTS.frequency,
    authority: custom?.authority ?? DEFAULT_WEIGHTS.authority,
    velocity: custom?.velocity ?? DEFAULT_WEIGHTS.velocity,
    engagement: custom?.engagement ?? DEFAULT_WEIGHTS.engagement,
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

// ─── Engagement scoring ───────────────────────────────────────────────────────
// 매칭된 아이템의 engagement(upvotes, stars, comments) 합산 → 0~1 정규화

function calculateEngagementScore(
  keyword: NormalizedKeyword,
  sourceItems: RssItem[]
): number {
  if (keyword.candidates.matchedItems.size === 0) return 0;

  let totalScore = 0;
  let totalComments = 0;

  for (const idx of keyword.candidates.matchedItems) {
    const item = sourceItems[idx];
    if (!item?.engagement) continue;
    totalScore += item.engagement.score;
    totalComments += item.engagement.comments;
  }

  // 합산이 0이면 engagement 데이터가 없는 소스만 매칭된 것
  if (totalScore === 0 && totalComments === 0) return 0;

  // log 스케일로 정규화 (score 100 ≈ 0.5, 1000 ≈ 0.75, 10000 ≈ 1.0)
  const combined = totalScore + totalComments * 2; // 댓글은 가중치 2배
  const normalized = Math.log10(combined + 1) / 4; // log10(10001) ≈ 4
  return Math.min(1, Math.max(0, normalized));
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

  // frequency: 유니크 도메인 수 + 보정 보너스 기반
  const frequency = Math.min(
    1,
    (keyword.candidates.domains.size + keyword.candidates.domainBonus) / 10
  );

  // authority: tier 기반에 선택적 source override를 반영
  const authority = Math.max(
    TIER_AUTHORITY[keyword.candidates.tier] ?? 0.2,
    keyword.candidates.authorityOverride
  );

  const velocity = calculateVelocityScore(
    keyword,
    options?.sourceItems ?? [],
    now,
    profile
  );

  const engagement = calculateEngagementScore(
    keyword,
    options?.sourceItems ?? []
  );

  // internal: 기본 0 (운영자 부스팅/블랙리스트로 추후 조정)
  const internal = 0;

  const total =
    recency * weights.recency +
    frequency * weights.frequency +
    authority * weights.authority +
    velocity * weights.velocity +
    engagement * weights.engagement +
    internal * weights.internal;

  return {
    recency: parseFloat(recency.toFixed(4)),
    frequency: parseFloat(frequency.toFixed(4)),
    authority: parseFloat(authority.toFixed(4)),
    velocity: parseFloat(velocity.toFixed(4)),
    engagement: parseFloat(engagement.toFixed(4)),
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
