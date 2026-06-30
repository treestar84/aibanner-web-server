import assert from "node:assert/strict";
import test from "node:test";

import {
  selectTopTrendDisplayKeywords,
  type TopTrendDisplayKeyword,
} from "@/lib/api/top_trends_display_quality";

function buildKeyword(
  rank: number,
  overrides: Partial<TopTrendDisplayKeyword> = {}
): TopTrendDisplayKeyword {
  return {
    keyword: `Keyword ${rank}`,
    keyword_id: `keyword_${rank}`,
    rank,
    score_recency: 0.72,
    score_velocity: 0.42,
    score_authority: 0.5,
    score_engagement: 0.3,
    score_internal: 0,
    summary_short: "Current developer-relevant trend.",
    summary_short_en: "Current developer-relevant trend.",
    top_source_url: "https://example.com/source",
    top_source_domain: "example.com",
    is_manual: false,
    ...overrides,
  };
}

test("selectTopTrendDisplayKeywords hides weak null-source lightweight rows when top20 guard is enabled", () => {
  const givenKeywords = [
    ...Array.from({ length: 10 }, (_, index) => buildKeyword(index + 1)),
    buildKeyword(11, {
      keyword: "MCP server",
      keyword_id: "mcp_server",
      score_recency: 0.08,
      score_velocity: 0,
      score_authority: 0.12,
      score_engagement: 0.03,
      summary_short: "",
      summary_short_en: "",
      top_source_url: null,
      top_source_domain: null,
    }),
  ];

  const whenVisible = selectTopTrendDisplayKeywords(givenKeywords, 20, true);

  assert.equal(whenVisible.some((keyword) => keyword.keyword_id === "mcp_server"), false);
});

test("selectTopTrendDisplayKeywords keeps structured release rows without summary", () => {
  const givenKeywords = [
    ...Array.from({ length: 10 }, (_, index) => buildKeyword(index + 1)),
    buildKeyword(11, {
      keyword: "vercel/ai ai@7.0.0-canary.165",
      keyword_id: "vercel_ai_7_0_0_canary_165",
      summary_short: "",
      summary_short_en: "",
      top_source_url: null,
      top_source_domain: null,
    }),
  ];

  const whenVisible = selectTopTrendDisplayKeywords(givenKeywords, 20, true);

  assert.equal(
    whenVisible.some((keyword) => keyword.keyword_id === "vercel_ai_7_0_0_canary_165"),
    true
  );
});

test("selectTopTrendDisplayKeywords preserves limit10 behavior", () => {
  const givenKeywords = Array.from({ length: 12 }, (_, index) =>
    buildKeyword(index + 1, {
      summary_short: "",
      summary_short_en: "",
      top_source_url: null,
      top_source_domain: null,
    })
  );

  const whenVisible = selectTopTrendDisplayKeywords(givenKeywords, 10, true);

  assert.deepEqual(
    whenVisible.map((keyword) => keyword.rank),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
});
