import type { KeywordPolicyMeta } from "@/lib/pipeline/ranking_policy";

export interface RankingCandidateDebugInput {
  policyDelta: number;
  stabilityDelta: number;
  manualDelta: number;
  isInsertedManual: boolean;
  meta: KeywordPolicyMeta | null;
}

export interface RankingCandidateDebug {
  policy_delta: number;
  stability_delta: number;
  manual_delta: number;
  family_key: string | null;
  family_label: string | null;
  family_source: string | null;
  keyword_kind: string | null;
  version_kind: string | null;
  internal_reason: string | null;
}

function normalizeDelta(value: number): number {
  return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : 0;
}

export function calculateFixedCandidateBonus(
  score: {
    recency: number;
    frequency: number;
    authority: number;
    velocity: number;
    engagement: number;
    total: number;
  },
  weights: {
    recency: number;
    frequency: number;
    authority: number;
    velocity: number;
    engagement: number;
  }
): number {
  const baseWeightedTotal =
    score.recency * weights.recency +
    score.frequency * weights.frequency +
    score.authority * weights.authority +
    score.velocity * weights.velocity +
    score.engagement * weights.engagement;

  return parseFloat((score.total - baseWeightedTotal).toFixed(4));
}

export function buildRankingCandidateDebug(
  input: RankingCandidateDebugInput
): RankingCandidateDebug {
  const policyDelta = normalizeDelta(input.policyDelta);
  const stabilityDelta = normalizeDelta(input.stabilityDelta);
  const manualDelta = normalizeDelta(input.manualDelta);

  const reasons = [
    policyDelta !== 0 ? "policy" : null,
    stabilityDelta !== 0 ? "stability" : null,
    manualDelta !== 0
      ? input.isInsertedManual
        ? "manual_insert"
        : "manual_boost"
      : null,
  ].filter(Boolean);

  return {
    policy_delta: policyDelta,
    stability_delta: stabilityDelta,
    manual_delta: manualDelta,
    family_key: input.meta?.familyKey ?? null,
    family_label: input.meta?.familyLabel ?? null,
    family_source: input.meta?.familySource ?? null,
    keyword_kind: input.meta?.keywordKind ?? null,
    version_kind: input.meta?.versionKind ?? null,
    internal_reason: reasons.length > 0 ? reasons.join(", ") : null,
  };
}
