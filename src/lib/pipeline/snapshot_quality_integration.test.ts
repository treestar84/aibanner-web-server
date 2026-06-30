import assert from "node:assert/strict";
import test from "node:test";

import { applyRankingQualityPolicy } from "@/lib/pipeline/ranking_quality_policy";

const baseScore = {
  total: 0.5,
  recency: 0.7,
  velocity: 0.4,
  engagement: 0.3,
  authority: 0.6,
};

test("applyRankingQualityPolicy keeps order unchanged in shadow mode while producing reasons", () => {
  const candidates = [
    {
      keywordId: "protected",
      keyword: "Claude Code v2.1.165",
      score: { ...baseScore, total: 0.5 },
      sourceTexts: ["Claude Code v2.1.165 release on npm"],
      sourceDomains: ["npmjs.com"],
      latestSourceAt: "2026-06-05T05:22:42.188Z",
      appearances: 0,
      isManual: false,
    },
    {
      keywordId: "noise",
      keyword: "MCP server",
      score: { ...baseScore, total: 0.49, recency: 0.04, velocity: 0, engagement: 0.02, authority: 0.2 },
      sourceTexts: [],
      sourceDomains: [],
      latestSourceAt: null,
      appearances: 12,
      isManual: false,
    },
  ];

  const result = applyRankingQualityPolicy(candidates, {
    shadowOnly: true,
    sourceQualityEnabled: true,
    genericContextPolicyEnabled: true,
    repeatExposurePolicyEnabled: true,
    now: new Date("2026-06-06T00:00:00.000Z"),
  });

  assert.deepEqual(
    result.items.map((item) => item.keywordId),
    ["protected", "noise"]
  );
  assert.equal(result.qualityByKeywordId.get("noise")?.reasons.length !== 0, true);
});

test("applyRankingQualityPolicy demotes known noise and keeps protected release in enabled mode", () => {
  const candidates = [
    {
      keywordId: "noise",
      keyword: "MCP server",
      score: { ...baseScore, total: 0.51, recency: 0.04, velocity: 0, engagement: 0.02, authority: 0.2 },
      sourceTexts: [],
      sourceDomains: [],
      latestSourceAt: null,
      appearances: 12,
      isManual: false,
    },
    {
      keywordId: "protected",
      keyword: "Claude Code v2.1.165",
      score: { ...baseScore, total: 0.5 },
      sourceTexts: ["Claude Code v2.1.165 release on npm"],
      sourceDomains: ["npmjs.com"],
      latestSourceAt: "2026-06-05T05:22:42.188Z",
      appearances: 0,
      isManual: false,
    },
  ];

  const result = applyRankingQualityPolicy(candidates, {
    shadowOnly: false,
    sourceQualityEnabled: true,
    genericContextPolicyEnabled: true,
    repeatExposurePolicyEnabled: true,
    now: new Date("2026-06-06T00:00:00.000Z"),
  });

  assert.deepEqual(
    result.items.map((item) => item.keywordId),
    ["protected", "noise"]
  );
  assert.equal(result.qualityByKeywordId.get("protected")?.appliedDelta, 0);
  assert.equal((result.qualityByKeywordId.get("noise")?.appliedDelta ?? 0) < 0, true);
});

test("applyRankingQualityPolicy never applies quality delta to manual keywords", () => {
  const result = applyRankingQualityPolicy(
    [
      {
        keywordId: "manual_keyword",
        keyword: "MCP server",
        score: { ...baseScore, total: 0.2, recency: 0.04, velocity: 0, engagement: 0, authority: 0.2 },
        sourceTexts: [],
        sourceDomains: [],
        latestSourceAt: null,
        appearances: 20,
        isManual: true,
      },
    ],
    {
      shadowOnly: false,
      sourceQualityEnabled: true,
      genericContextPolicyEnabled: true,
      repeatExposurePolicyEnabled: true,
      now: new Date("2026-06-06T00:00:00.000Z"),
    }
  );

  assert.equal(result.qualityByKeywordId.get("manual_keyword")?.appliedDelta, 0);
});
