import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateFreshnessEvidence,
  type FreshnessEvidenceInput,
} from "@/lib/pipeline/freshness_evidence";

const now = new Date("2026-06-06T00:00:00.000Z");

function buildInput(
  overrides: Partial<FreshnessEvidenceInput> = {}
): FreshnessEvidenceInput {
  return {
    keyword: "Claude Code v2.1.165",
    score_recency: 0.72,
    score_velocity: 0.38,
    score_engagement: 0.3,
    score_authority: 0.6,
    now,
    sources: [
      {
        title: "Claude Code v2.1.165 release",
        url: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
        domain: "npmjs.com",
        published_at_utc: "2026-06-05T05:22:42.188Z",
        tier: "P1_CONTEXT",
      },
    ],
    first_seen_at_utc: "2026-06-05T05:22:42.188Z",
    previous_top10_appearances: 0,
    ...overrides,
  };
}

test("evaluateFreshnessEvidence returns recent_source when a dated source is fresh", () => {
  const result = evaluateFreshnessEvidence(buildInput());

  assert.equal(result.eligible, true);
  assert.equal(result.reasons.includes("recent_source"), true);
});

test("evaluateFreshnessEvidence returns structured_release when official package source has no date", () => {
  const result = evaluateFreshnessEvidence(
    buildInput({
      sources: [
        {
          title: "vercel/ai ai@7.0.0-canary.165",
          url: "https://www.npmjs.com/package/ai",
          domain: "npmjs.com",
          published_at_utc: null,
          tier: "P1_CONTEXT",
        },
      ],
      score_recency: 0.2,
      score_velocity: 0,
      score_engagement: 0,
    })
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reasons.includes("structured_release"), true);
});

test("evaluateFreshnessEvidence returns breakout_velocity for strong current acceleration", () => {
  const result = evaluateFreshnessEvidence(
    buildInput({
      sources: [],
      score_recency: 0.68,
      score_velocity: 0.72,
      score_engagement: 0.18,
    })
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reasons.includes("breakout_velocity"), true);
});

test("evaluateFreshnessEvidence returns community_interest for high engagement", () => {
  const result = evaluateFreshnessEvidence(
    buildInput({
      sources: [],
      score_recency: 0.32,
      score_velocity: 0.12,
      score_engagement: 0.76,
    })
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reasons.includes("community_interest"), true);
});

test("evaluateFreshnessEvidence returns stale_no_evidence for old evergreen with weak scores", () => {
  const result = evaluateFreshnessEvidence(
    buildInput({
      keyword: "MCP server",
      sources: [
        {
          title: "MCP server overview",
          url: "https://example.com/mcp-server-guide",
          domain: "example.com",
          published_at_utc: "2026-05-30T00:00:00.000Z",
          tier: "P2_RAW",
        },
      ],
      score_recency: 0.04,
      score_velocity: 0,
      score_engagement: 0.05,
      first_seen_at_utc: "2026-05-30T00:00:00.000Z",
      previous_top10_appearances: 12,
    })
  );

  assert.equal(result.eligible, false);
  assert.equal(result.reasons.includes("stale_no_evidence"), true);
});

test("evaluateFreshnessEvidence returns reignition for old topic with recent source", () => {
  const result = evaluateFreshnessEvidence(
    buildInput({
      keyword: "Project Solara",
      sources: [
        {
          title: "Project Solara gets renewed Build developer attention",
          url: "https://blogs.microsoft.com/project-solara",
          domain: "microsoft.com",
          published_at_utc: "2026-06-03T20:30:00.000Z",
          tier: "P1_CONTEXT",
        },
      ],
      first_seen_at_utc: "2026-03-20T00:00:00.000Z",
      previous_top10_appearances: 10,
      score_recency: 0.58,
      score_velocity: 0.56,
      score_engagement: 0.53,
    })
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reasons.includes("reignition"), true);
});
