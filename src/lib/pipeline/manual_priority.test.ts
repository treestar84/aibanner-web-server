import test from "node:test";
import assert from "node:assert/strict";

import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import type { RankedKeyword } from "@/lib/pipeline/scoring";
import type { PipelineMode } from "@/lib/pipeline/mode";
import type { ManualKeyword } from "@/lib/db/queries";
import {
  applyInternalDelta,
  applyManualKeywordPriority,
  type RankedKeywordWithDelta,
} from "@/lib/pipeline/manual_priority";

function buildRankedItem(
  keywordId: string,
  keyword: string,
  rank: number,
  total: number,
  aliases: string[] = []
): RankedKeywordWithDelta {
  const normalizedKeyword: NormalizedKeyword = {
    keywordId,
    keyword,
    aliases,
    candidates: {
      text: keyword,
      count: 1,
      domains: new Set(["example.com"]),
      matchedItems: new Set<number>(),
      latestAt: new Date("2026-03-28T00:00:00.000Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
  };
  const ranked: RankedKeyword = {
    keyword: normalizedKeyword,
    rank,
    score: {
      recency: 0.5,
      frequency: 0.2,
      authority: 0.6,
      velocity: 0.2,
      engagement: 0.1,
      internal: 0,
      total,
    },
  };
  return {
    ...ranked,
    deltaRank: 0,
    isNew: false,
  };
}

function buildManualKeyword(keyword: string): ManualKeyword {
  return {
    id: 1,
    keyword,
    mode: "realtime" as PipelineMode,
    ttl_hours: 24,
    enabled: true,
    starts_at: "2026-03-28T00:00:00.000Z",
    expires_at: "2026-03-29T00:00:00.000Z",
    created_at: "2026-03-28T00:00:00.000Z",
    updated_at: "2026-03-28T00:00:00.000Z",
    remaining_seconds: 3600,
    is_active: true,
  };
}

test("applyInternalDelta adjusts internal and total together", () => {
  const result = applyInternalDelta(buildRankedItem("claude_code", "Claude Code", 1, 0.4), 0.05);
  assert.equal(result.score.internal, 0.05);
  assert.equal(result.score.total, 0.45);
});

test("applyManualKeywordPriority boosts existing keyword via alias match without duplicating rows", () => {
  const items = [
    buildRankedItem("claude_code_teams", "Claude Code Teams", 1, 0.41, ["Claude Teams"]),
    buildRankedItem("cursor_memory", "Cursor Memory", 2, 0.38),
  ];

  const result = applyManualKeywordPriority("realtime", items, [buildManualKeyword("Claude Teams")], {
    internalBonus: 3,
    totalBonus: 6,
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].keyword.keywordId, "claude_code_teams");
  assert.equal(result.items[0].score.internal, 3);
  assert.equal(result.items[0].score.total, 6.41);
  assert.equal(result.manualDeltaByKeywordId.get("claude_code_teams"), 6);
});

test("applyManualKeywordPriority inserts missing manual keyword once and preserves unique top list", () => {
  const items = [
    buildRankedItem("a", "A", 1, 0.5),
    buildRankedItem("b", "B", 2, 0.4),
    buildRankedItem("c", "C", 3, 0.3),
  ];

  const result = applyManualKeywordPriority("realtime", items, [buildManualKeyword("Important Keyword")], {
    internalBonus: 3,
    totalBonus: 6,
  });

  assert.equal(result.items.length, 4);
  assert.equal(result.items[0].keyword.keyword, "Important Keyword");
  assert.equal(result.insertedKeywordIds.has(result.items[0].keyword.keywordId), true);
  assert.equal(new Set(result.items.map((item) => item.keyword.keywordId)).size, 4);
});

test("applyManualKeywordPriority keeps top 10 length stable after manual insertion", () => {
  const items = Array.from({ length: 10 }, (_, index) =>
    buildRankedItem(`k${index + 1}`, `Keyword ${index + 1}`, index + 1, 1 - index * 0.01)
  );

  const result = applyManualKeywordPriority(
    "realtime",
    items,
    [buildManualKeyword("Breaking Topic")],
    {
      internalBonus: 3,
      totalBonus: 6,
    }
  ).items.slice(0, 10);

  assert.equal(result.length, 10);
  assert.equal(result[0].keyword.keyword, "Breaking Topic");
  assert.equal(result.some((item) => item.keyword.keyword === "Keyword 10"), false);
});
