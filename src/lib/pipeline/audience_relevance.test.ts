import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import { selectAudienceRelevantKeywords } from "@/lib/pipeline/audience_relevance";

function buildKeyword(index: number): NormalizedKeyword {
  return {
    keywordId: `keyword_${index}`,
    keyword: `Keyword ${index}`,
    aliases: [],
    candidates: {
      text: `Keyword ${index}`,
      count: 1,
      domains: new Set(["example.com"]),
      matchedItems: new Set([index]),
      latestAt: new Date("2026-06-07T00:00:00.000Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
  };
}

test("selectAudienceRelevantKeywords backfills to the minimum instead of shrinking Top20 candidates", () => {
  const keywords = Array.from({ length: 24 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords.map((keyword, index) => [
      keyword.keyword,
      index < 7
        ? { relevance: 9, novelty: 9 }
        : { relevance: 6, novelty: 4 },
    ])
  );

  const selected = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
  });

  assert.equal(selected.length, 20);
  assert.deepEqual(
    selected.slice(0, 7).map((keyword) => keyword.keywordId),
    keywords.slice(0, 7).map((keyword) => keyword.keywordId)
  );
});

test("selectAudienceRelevantKeywords still removes weak items above the minimum", () => {
  const keywords = Array.from({ length: 24 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords.map((keyword, index) => [
      keyword.keyword,
      index < 21
        ? { relevance: 9, novelty: 9 }
        : { relevance: 2, novelty: 2 },
    ])
  );

  const selected = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
  });

  assert.equal(selected.length, 21);
  assert.equal(selected.some((keyword) => keyword.keywordId === "keyword_24"), false);
});
