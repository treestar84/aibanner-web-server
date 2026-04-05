import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRankingCandidateDebug,
  calculateFixedCandidateBonus,
} from "@/lib/pipeline/ranking_candidate_debug";

test("calculateFixedCandidateBonus preserves exact total for manual insertions", () => {
  const fixedBonus = calculateFixedCandidateBonus(
    {
      recency: 1,
      frequency: 1,
      authority: 1,
      velocity: 1,
      engagement: 1,
      total: 16,
    },
    {
      recency: 0.28,
      frequency: 0.12,
      authority: 0.08,
      velocity: 0.3,
      engagement: 0.22,
    }
  );

  assert.equal(fixedBonus, 15);
});

test("buildRankingCandidateDebug serializes policy, stability, and manual reasons", () => {
  const debug = buildRankingCandidateDebug({
    policyDelta: -0.12,
    stabilityDelta: 0.04,
    manualDelta: 6,
    isInsertedManual: false,
    meta: {
      familyKey: "repo:ggml-org/llama.cpp",
      familyLabel: "ggml-org/llama.cpp",
      familySource: "repo",
      keywordKind: "version_only",
      versionKind: "build",
    },
  });

  assert.equal(debug.policy_delta, -0.12);
  assert.equal(debug.stability_delta, 0.04);
  assert.equal(debug.manual_delta, 6);
  assert.equal(debug.family_key, "repo:ggml-org/llama.cpp");
  assert.equal(debug.version_kind, "build");
  assert.equal(debug.internal_reason, "policy, stability, manual_boost");
});

test("buildRankingCandidateDebug marks inserted manual keywords distinctly", () => {
  const debug = buildRankingCandidateDebug({
    policyDelta: 0,
    stabilityDelta: 0,
    manualDelta: 6,
    isInsertedManual: true,
    meta: null,
  });

  assert.equal(debug.internal_reason, "manual_insert");
  assert.equal(debug.family_key, null);
});
