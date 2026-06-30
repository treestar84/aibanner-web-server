import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateGenericKeywordDelta,
  capNegativeQualityDelta,
} from "@/lib/pipeline/generic_keyword_policy";

test("calculateGenericKeywordDelta demotes unanchored MCP server generic keyword", () => {
  const result = calculateGenericKeywordDelta({
    keyword: "MCP server",
    sourceTexts: ["A general guide to MCP server setup"],
    freshnessReasons: ["stale_no_evidence"],
    authority: 0.3,
    engagement: 0.04,
  });

  assert.equal(result.delta < 0, true);
  assert.equal(result.reasons.includes("generic_unanchored"), true);
});

test("calculateGenericKeywordDelta preserves anchored MCP integration context", () => {
  const result = calculateGenericKeywordDelta({
    keyword: "MCP server",
    sourceTexts: ["Snowflake and Claroty launch an MCP server integration for enterprise agents"],
    freshnessReasons: ["recent_source"],
    authority: 0.7,
    engagement: 0.35,
  });

  assert.equal(result.delta >= 0, true);
  assert.equal(result.reasons.includes("generic_anchored"), true);
});

test("calculateGenericKeywordDelta demotes unanchored AI coding agent keyword", () => {
  const result = calculateGenericKeywordDelta({
    keyword: "AI coding agent",
    sourceTexts: [],
    freshnessReasons: ["stale_no_evidence"],
    authority: 0.2,
    engagement: 0,
  });

  assert.equal(result.delta < 0, true);
  assert.equal(result.reasons.includes("generic_unanchored"), true);
});

test("calculateGenericKeywordDelta protects specific Claude Code contexts", () => {
  const protectedKeywords = [
    "Claude Code plugin tracker",
    "claude-memory",
    "Claude Code v2.1.165",
  ];

  const results = protectedKeywords.map((keyword) =>
    calculateGenericKeywordDelta({
      keyword,
      sourceTexts: ["Claude Code v2.1.165 plugin tracker release on npm and GitHub"],
      freshnessReasons: ["structured_release"],
      authority: 0.72,
      engagement: 0.3,
    })
  );

  assert.equal(results.every((result) => result.delta >= 0), true);
  assert.equal(
    results.every((result) => result.reasons.includes("specific_context_protected")),
    true
  );
});

test("capNegativeQualityDelta bounds combined generic policy penalties", () => {
  const capped = capNegativeQualityDelta([-0.07, -0.08, -0.04], -0.12);

  assert.equal(capped, -0.12);
});
