import test from "node:test";
import assert from "node:assert/strict";

import {
  recalculateRankingCandidates,
  type RankingSimulatorCandidate,
  type RankingSimulatorWeights,
} from "@/lib/admin/ranking_simulator";

function buildCandidate(
  overrides: Partial<RankingSimulatorCandidate> = {}
): RankingSimulatorCandidate {
  return {
    snapshot_id: "20260328_1100_KST",
    keyword: "Claude Code",
    keyword_normalized: "claude_code",
    score_recency: 0.4,
    score_frequency: 0.2,
    score_authority: 0.84,
    score_velocity: 0.25,
    score_engagement: 0.3,
    score_internal: 0,
    total_score: 0.3442,
    source_count: 3,
    top_source_title: null,
    top_source_domain: "claude.ai",
    is_manual: false,
    policy_delta: 0,
    stability_delta: 0,
    manual_delta: 0,
    family_key: null,
    family_label: null,
    family_source: null,
    keyword_kind: null,
    version_kind: null,
    internal_reason: null,
    ...overrides,
  };
}

test("recalculateRankingCandidates matches stored totals when using server weights and fixed internal bonus", () => {
  const weights: RankingSimulatorWeights = {
    recency: 0.28,
    frequency: 0.12,
    authority: 0.08,
    velocity: 0.3,
    engagement: 0.22,
  };

  const result = recalculateRankingCandidates(
    [
      buildCandidate({
        keyword: "llama.cpp b8555",
        keyword_normalized: "llama_cpp_b8555",
        score_recency: 0.6,
        score_frequency: 0.1,
        score_authority: 0.6,
        score_velocity: 0.2,
        score_engagement: 0.05,
        score_internal: -0.15,
        total_score: 0.149,
      }),
      buildCandidate({
        score_internal: 0.04,
        total_score: 0.3842,
      }),
    ],
    weights
  );

  assert.equal(result[0].simTotal, result[0].total_score);
  assert.equal(result[1].simTotal, result[1].total_score);
});

test("recalculateRankingCandidates uses fixed internal bonus when reweighting base factors", () => {
  const weights: RankingSimulatorWeights = {
    recency: 0.1,
    frequency: 0.1,
    authority: 0.1,
    velocity: 0.1,
    engagement: 0.1,
  };

  const [candidate] = recalculateRankingCandidates(
    [
      buildCandidate({
        score_recency: 1,
        score_frequency: 0,
        score_authority: 0,
        score_velocity: 0,
        score_engagement: 0,
        score_internal: 0.25,
      }),
    ],
    weights
  );

  assert.equal(candidate.simTotal, 0.35);
});
