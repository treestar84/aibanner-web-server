import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNaverPublishedAt,
  stripNaverHtml,
} from "@/lib/pipeline/naver_search";
import {
  isKoreanPreferredSource,
  scoreSourcePriority,
  type TavilySource,
} from "@/lib/pipeline/tavily";

test("stripNaverHtml removes highlight tags and decodes common entities", () => {
  assert.equal(
    stripNaverHtml("<b>OpenAI</b> &amp; 네이버 &quot;검색&quot;"),
    'OpenAI & 네이버 "검색"'
  );
});

test("parseNaverPublishedAt handles news pubDate and blog postdate", () => {
  assert.equal(
    parseNaverPublishedAt({
      pubDate: "Mon, 20 Apr 2026 09:30:00 +0900",
    }),
    "2026-04-20T00:30:00.000Z"
  );
  assert.equal(
    parseNaverPublishedAt({
      postdate: "20260420",
    }),
    "2026-04-20T00:00:00.000Z"
  );
});

test("Korean preferred sources outrank exact global matches", () => {
  const koreanSource: TavilySource = {
    title: "클로드 코드 업데이트",
    url: "https://news.naver.com/example",
    domain: "news.naver.com",
    snippet: "국내 개발자들이 주목한 업데이트",
    imageUrl: null,
    publishedAt: null,
    type: "news",
    provider: "naver",
  };
  const globalSource: TavilySource = {
    title: "Claude Code update",
    url: "https://example.com/claude-code",
    domain: "example.com",
    snippet: "Claude Code update details",
    imageUrl: null,
    publishedAt: null,
    type: "news",
    provider: "tavily",
  };

  assert.equal(isKoreanPreferredSource(koreanSource), true);
  assert.ok(
    scoreSourcePriority(koreanSource, "Claude Code") >
      scoreSourcePriority(globalSource, "Claude Code")
  );
});
