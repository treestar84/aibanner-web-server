import test from "node:test";
import assert from "node:assert/strict";

import type { RankingSimulatorCandidate } from "@/lib/admin/ranking_simulator";
import type { RankingSimulatorWeights } from "@/lib/admin/ranking_simulator";
import {
  replaySnapshotRanking,
  summarizeRankingReplay,
} from "@/lib/admin/ranking_replay";

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

test("replaySnapshotRanking reproduces stored top ranks with server weights", () => {
  const weights: RankingSimulatorWeights = {
    recency: 0.28,
    frequency: 0.12,
    authority: 0.08,
    velocity: 0.3,
    engagement: 0.22,
  };

  const result = replaySnapshotRanking(
    [
      buildCandidate({
        keyword: "Claude Code",
        keyword_normalized: "claude_code",
        score_internal: 0.04,
        total_score: 0.3842,
      }),
      buildCandidate({
        keyword: "Cursor Memory",
        keyword_normalized: "cursor_memory",
        score_recency: 0.8,
        score_frequency: 0.2,
        score_authority: 0.6,
        score_velocity: 0.2,
        score_engagement: 0.1,
        score_internal: 0,
        total_score: 0.344,
      }),
    ],
    weights,
    2
  );

  assert.deepEqual(
    result.map((item) => item.keyword_normalized),
    ["claude_code", "cursor_memory"]
  );
});

test("summarizeRankingReplay reports rank mismatches after reweighting", () => {
  const storedWeights: RankingSimulatorWeights = {
    recency: 0.28,
    frequency: 0.12,
    authority: 0.08,
    velocity: 0.3,
    engagement: 0.22,
  };
  const changedWeights: RankingSimulatorWeights = {
    recency: 0.6,
    frequency: 0.05,
    authority: 0.05,
    velocity: 0.2,
    engagement: 0.1,
  };
  const candidates = [
    buildCandidate({
      keyword: "Claude Code",
      keyword_normalized: "claude_code",
      score_internal: 0.04,
      total_score: 0.3842,
    }),
    buildCandidate({
      keyword: "Cursor Memory",
      keyword_normalized: "cursor_memory",
      score_recency: 0.8,
      score_frequency: 0.2,
      score_authority: 0.6,
      score_velocity: 0.2,
      score_engagement: 0.1,
      score_internal: 0,
      total_score: 0.344,
    }),
  ];

  const baseline = summarizeRankingReplay(candidates, storedWeights, 2);
  const changed = summarizeRankingReplay(candidates, changedWeights, 2);

  assert.equal(baseline.exactRankMatches, 2);
  assert.equal(changed.exactRankMatches, 0);
  assert.equal(changed.mismatches.length, 2);
});
