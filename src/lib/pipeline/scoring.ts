import type { NormalizedKeyword } from "./keywords";

// ─── Weights (PRD §4.3) ───────────────────────────────────────────────────────

const WEIGHTS = {
  recency: 0.45,
  frequency: 0.20,
  authority: 0.20,
  internal: 0.15,
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
  internal: number;
  total: number;
}

export function calculateScore(keyword: NormalizedKeyword): ScoreBreakdown {
  const now = Date.now();
  const ageMs = now - keyword.candidates.latestAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // recency: 지수 감쇠, 반감기 36h (6h→0.85, 24h→0.51, 48h→0.26, 72h→0.14)
  const recency = Math.exp(-ageHours / 36);

  // frequency: 유니크 도메인 수 기반 (최대 10개 도메인 → 1.0)
  const frequency = Math.min(1, keyword.candidates.domains.size / 10);

  // authority: tier 기반
  const authority = TIER_AUTHORITY[keyword.candidates.tier] ?? 0.2;

  // internal: 기본 0 (운영자 부스팅/블랙리스트로 추후 조정)
  const internal = 0;

  const total =
    recency * WEIGHTS.recency +
    frequency * WEIGHTS.frequency +
    authority * WEIGHTS.authority +
    internal * WEIGHTS.internal;

  return {
    recency: parseFloat(recency.toFixed(4)),
    frequency: parseFloat(frequency.toFixed(4)),
    authority: parseFloat(authority.toFixed(4)),
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
  limit = 10
): RankedKeyword[] {
  const scored = keywords.map((kw) => ({
    keyword: kw,
    score: calculateScore(kw),
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
