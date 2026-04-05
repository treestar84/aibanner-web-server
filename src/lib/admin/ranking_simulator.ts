export interface RankingSimulatorCandidate {
  snapshot_id: string;
  keyword: string;
  keyword_normalized: string;
  score_recency: number;
  score_frequency: number;
  score_authority: number;
  score_velocity: number;
  score_engagement: number;
  score_internal: number;
  total_score: number;
  source_count: number;
  top_source_title: string | null;
  top_source_domain: string | null;
  is_manual: boolean;
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

export interface RankingSimulatorWeights {
  recency: number;
  frequency: number;
  authority: number;
  velocity: number;
  engagement: number;
}

export interface RankingSimulatorResult extends RankingSimulatorCandidate {
  simTotal: number;
  simRank: number;
  origRank: number;
}

function calculateBaseWeightedTotal(
  candidate: RankingSimulatorCandidate,
  weights: RankingSimulatorWeights
): number {
  return (
    candidate.score_recency * weights.recency +
    candidate.score_frequency * weights.frequency +
    candidate.score_authority * weights.authority +
    candidate.score_velocity * weights.velocity +
    candidate.score_engagement * weights.engagement
  );
}

export function calculateSimulatorTotal(
  candidate: RankingSimulatorCandidate,
  weights: RankingSimulatorWeights
): number {
  return parseFloat(
    (calculateBaseWeightedTotal(candidate, weights) + candidate.score_internal).toFixed(4)
  );
}

export function recalculateRankingCandidates(
  candidates: RankingSimulatorCandidate[],
  weights: RankingSimulatorWeights
): RankingSimulatorResult[] {
  const sorted = [...candidates]
    .sort((a, b) => b.total_score - a.total_score)
    .map((candidate, index) => ({ ...candidate, origRank: index + 1 }));

  const withSim = sorted.map((candidate) => ({
    ...candidate,
    simTotal: calculateSimulatorTotal(candidate, weights),
  }));

  withSim.sort((a, b) => b.simTotal - a.simTotal);
  return withSim.map((candidate, index) => ({ ...candidate, simRank: index + 1 }));
}
