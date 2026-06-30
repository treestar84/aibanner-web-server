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

test("selectAudienceRelevantKeywords never backfills explicit evergreen keywords (novelty <= 3)", () => {
  const keywords = Array.from({ length: 10 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords.map((keyword, index) => [
      keyword.keyword,
      index < 5
        ? { relevance: 9, novelty: 9 }
        : index < 8
          ? { relevance: 6, novelty: 5 } // 백필 가능 (novelty > 3)
          : { relevance: 8, novelty: 2 }, // evergreen: 백필 금지 ("MCP server" 류)
    ])
  );

  const selected = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
  });

  // visible 5 + 백필 가능 3 = 8. evergreen 2개는 minimum 미달이어도 제외.
  assert.equal(selected.length, 8);
  const selectedIds = new Set(selected.map((keyword) => keyword.keywordId));
  assert.equal(selectedIds.has("keyword_9"), false);
  assert.equal(selectedIds.has("keyword_10"), false);
});

test("selectAudienceRelevantKeywords treats missing scores as backfill candidates, not auto-pass", () => {
  const keywords = Array.from({ length: 24 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords
      .slice(0, 23) // keyword_24는 점수 누락
      .map((keyword, index) => [
        keyword.keyword,
        index < 21
          ? { relevance: 9, novelty: 9 }
          : { relevance: 6, novelty: 4 },
      ])
  );

  const selected = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
  });

  // visible 21 >= minimum → 백필 미발동 → 점수 누락 키워드는 자동 통과되지 않음
  assert.equal(selected.length, 21);
  assert.equal(selected.some((keyword) => keyword.keywordId === "keyword_24"), false);
});

test("selectAudienceRelevantKeywords backfills missing-score keywords first when below minimum", () => {
  const keywords = Array.from({ length: 10 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords
      .slice(0, 9) // keyword_10은 점수 누락
      .map((keyword, index) => [
        keyword.keyword,
        index < 3
          ? { relevance: 9, novelty: 9 }
          : { relevance: 6, novelty: 4 },
      ])
  );

  const selected = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 5,
  });

  assert.equal(selected.length, 5);
  // 점수 누락(quality 50)이 novelty 미달(quality ~6.4)보다 백필 우선
  assert.equal(selected.some((keyword) => keyword.keywordId === "keyword_10"), true);
});

test("selectAudienceRelevantKeywords relaxes novelty floor for high-engagement keywords", () => {
  const keywords = Array.from({ length: 24 }, (_, index) => buildKeyword(index + 1));
  const scores = Object.fromEntries(
    keywords.map((keyword, index) => [
      keyword.keyword,
      index < 22
        ? { relevance: 9, novelty: 9 }
        : { relevance: 8, novelty: 4 }, // 기본 하한(6) 미달, 완화 하한(4) 충족
    ])
  );

  const withoutEngagement = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
  });
  assert.equal(
    withoutEngagement.some((keyword) => keyword.keywordId === "keyword_23"),
    false
  );

  const withEngagement = selectAudienceRelevantKeywords(keywords, scores, {
    minimumKeywordCount: 20,
    highEngagementKeywordIds: new Set(["keyword_23"]),
  });
  assert.equal(
    withEngagement.some((keyword) => keyword.keywordId === "keyword_23"),
    true
  );
  // engagement가 없는 keyword_24는 여전히 탈락
  assert.equal(
    withEngagement.some((keyword) => keyword.keywordId === "keyword_24"),
    false
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
