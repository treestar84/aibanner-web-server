import {
  recalculateRankingCandidates,
  type RankingSimulatorCandidate,
  type RankingSimulatorResult,
  type RankingSimulatorWeights,
} from "@/lib/admin/ranking_simulator";

export interface RankingReplayMismatch {
  keyword_normalized: string;
  storedRank: number;
  simulatedRank: number;
  storedTotal: number;
  simulatedTotal: number;
}

export interface RankingReplaySummary {
  comparedCount: number;
  exactScoreMatches: number;
  exactRankMatches: number;
  mismatches: RankingReplayMismatch[];
  results: RankingSimulatorResult[];
}

export function replaySnapshotRanking(
  candidates: RankingSimulatorCandidate[],
  weights: RankingSimulatorWeights,
  limit = candidates.length
): RankingSimulatorResult[] {
  return recalculateRankingCandidates(candidates, weights).slice(0, limit);
}

export function summarizeRankingReplay(
  candidates: RankingSimulatorCandidate[],
  weights: RankingSimulatorWeights,
  limit = candidates.length
): RankingReplaySummary {
  const results = replaySnapshotRanking(candidates, weights, limit);
  let exactScoreMatches = 0;
  let exactRankMatches = 0;
  const mismatches: RankingReplayMismatch[] = [];

  for (const item of results) {
    if (item.simTotal === item.total_score) {
      exactScoreMatches += 1;
    }
    if (item.simRank === item.origRank) {
      exactRankMatches += 1;
      continue;
    }

    mismatches.push({
      keyword_normalized: item.keyword_normalized,
      storedRank: item.origRank,
      simulatedRank: item.simRank,
      storedTotal: item.total_score,
      simulatedTotal: item.simTotal,
    });
  }

  return {
    comparedCount: results.length,
    exactScoreMatches,
    exactRankMatches,
    mismatches,
    results,
  };
}
