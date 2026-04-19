import test from "node:test";
import assert from "node:assert/strict";

import { RSS_FEEDS, type RssFeedConfig } from "./rss";

// ─── Helper ──────────────────────────────────────────────────────────────────

function findFeed(url: string): RssFeedConfig | undefined {
  return RSS_FEEDS.find((f) => f.url === url);
}

// ─── Phase 1: 5점 미반영 → 즉시 추가 ────────────────────────────────────────

test("RSS_FEEDS includes GitHub Blog as P0_CURATED", () => {
  const feed = findFeed("https://github.blog/feed/");
  assert.ok(feed, "GitHub Blog feed should exist");
  assert.equal(feed.tier, "P0_CURATED");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes Vercel Blog as P1_CONTEXT", () => {
  const feed = findFeed("https://vercel.com/atom");
  assert.ok(feed, "Vercel Blog feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes Sourcegraph Blog as P1_CONTEXT", () => {
  const feed = findFeed("https://sourcegraph.com/blog/rss.xml");
  assert.ok(feed, "Sourcegraph Blog feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes Sebastian Raschka as P1_CONTEXT", () => {
  const feed = findFeed("https://sebastianraschka.com/rss_feed.xml");
  assert.ok(feed, "Sebastian Raschka feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes TensorFeed as P1_CONTEXT", () => {
  const feed = findFeed("https://tensorfeed.ai/feed.xml");
  assert.ok(feed, "TensorFeed feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes Dev.to Vibe Coding as COMMUNITY", () => {
  const feed = findFeed("https://dev.to/feed/tag/vibecoding");
  assert.ok(feed, "Dev.to Vibe Coding feed should exist");
  assert.equal(feed.tier, "COMMUNITY");
  assert.equal(feed.lang, "en");
});

// ─── Phase 2: 4점 미반영 → 선별 추가 ────────────────────────────────────────

test("RSS_FEEDS includes Pragmatic Engineer as P1_CONTEXT", () => {
  const feed = findFeed("https://newsletter.pragmaticengineer.com/feed");
  assert.ok(feed, "Pragmatic Engineer feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

test("RSS_FEEDS includes 宝玉 (baoyu.io) as P1_CONTEXT", () => {
  const feed = findFeed("https://baoyu.io/feed.xml");
  assert.ok(feed, "宝玉 feed should exist");
  assert.equal(feed.tier, "P1_CONTEXT");
  assert.equal(feed.lang, "en");
});

// ─── Phase 3: 3점 미반영 → 조건부 추가 (피드 작동 확인된 것만) ──────────────

test("RSS_FEEDS includes Towards AI as COMMUNITY", () => {
  const feed = findFeed("https://towardsai.net/feed");
  assert.ok(feed, "Towards AI feed should exist");
  assert.equal(feed.tier, "COMMUNITY");
  assert.equal(feed.lang, "en");
});

// ─── Phase 4: 기존 문제 소스 제거 ────────────────────────────────────────────

test("RSS_FEEDS does not include broken AI타임스 feed (404)", () => {
  const feed = findFeed("https://www.aitimes.com/rss/allArticle.xml");
  assert.equal(feed, undefined, "AI타임스 404 feed should be removed");
});

test("RSS_FEEDS does not include WAF-blocked 전자신문 AI feed", () => {
  const feed = findFeed("https://www.etnews.com/rss/section.xml?id=150");
  assert.equal(feed, undefined, "전자신문 AI WAF-blocked feed should be removed");
});

// ─── 전체 무결성 검증 ────────────────────────────────────────────────────────

test("all RSS_FEEDS entries have required fields", () => {
  for (const feed of RSS_FEEDS) {
    assert.ok(feed.url, `Feed "${feed.title}" must have a url`);
    assert.ok(feed.title, `Feed with url "${feed.url}" must have a title`);
    assert.ok(
      ["P0_CURATED", "P1_CONTEXT", "P2_RAW", "COMMUNITY"].includes(feed.tier),
      `Feed "${feed.title}" has invalid tier: ${feed.tier}`
    );
  }
});

test("RSS_FEEDS has no duplicate URLs", () => {
  const urls = RSS_FEEDS.map((f) => f.url);
  const unique = new Set(urls);
  assert.equal(urls.length, unique.size, "Duplicate URLs found in RSS_FEEDS");
});
