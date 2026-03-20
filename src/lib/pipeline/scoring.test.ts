import test from "node:test";
import assert from "node:assert/strict";

import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import { calculateScore } from "@/lib/pipeline/scoring";

function buildKeyword(
  overrides: Partial<NormalizedKeyword["candidates"]> = {}
): NormalizedKeyword {
  return {
    keywordId: "composer_2_by_cursor",
    keyword: "Composer 2 by Cursor",
    aliases: [],
    candidates: {
      text: "Composer 2 by Cursor",
      count: 1,
      domains: new Set(["producthunt.com"]),
      matchedItems: new Set([0]),
      latestAt: new Date("2026-03-20T08:00:00.000Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
      ...overrides,
    },
  };
}

test("calculateScore uses weighted domain bonus for frequency", () => {
  const score = calculateScore(buildKeyword({ domainBonus: 2 }), {
    now: new Date("2026-03-20T08:00:00.000Z"),
  });

  assert.equal(score.frequency, 0.3);
});

test("calculateScore prefers authority override over base tier score", () => {
  const score = calculateScore(buildKeyword({ authorityOverride: 0.9 }), {
    now: new Date("2026-03-20T08:00:00.000Z"),
  });

  assert.equal(score.authority, 0.9);
});
