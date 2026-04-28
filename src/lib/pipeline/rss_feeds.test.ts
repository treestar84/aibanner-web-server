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

// ─── Phase 1 (2026-04-23) — Subtask A 카탈로그 정비 결과 검증 ────────────────
// PRD: web-server/docs/plans/2026-04-23-pipeline-quality-implementation-plan.md §3.2.1

test("Phase 1: 바이브코딩 에디터 P0 — Zed Blog", () => {
  const feed = findFeed("https://zed.dev/blog.rss");
  assert.ok(feed, "Zed Blog feed should exist");
  assert.equal(feed.tier, "P0_CURATED");
  assert.equal(feed.lang, "en");
});

test("Phase 1: 바이브코딩 에디터 P0 — Replit Blog", () => {
  const feed = findFeed("https://blog.replit.com/feed.xml");
  assert.ok(feed, "Replit Blog feed should exist");
  assert.equal(feed.tier, "P0_CURATED");
});

test("제거 — Vercel Changelog (RSS endpoint 폐지, vercel.com/atom와 중복)", () => {
  assert.equal(findFeed("https://vercel.com/changelog/rss.xml"), undefined);
});

test("Phase 1: 한국 기술 블로그 P0 — 토스", () => {
  const feed = findFeed("https://toss.tech/rss.xml");
  assert.ok(feed, "토스 기술 블로그 feed should exist");
  assert.equal(feed.tier, "P0_CURATED");
  assert.equal(feed.lang, "ko");
});

test("Phase 1: 한국 기술 블로그 P0 — GeekNews Blog", () => {
  const feed = findFeed("https://news.hada.io/rss/blog");
  assert.ok(feed, "GeekNews Blog feed should exist");
  assert.equal(feed.tier, "P0_CURATED");
  assert.equal(feed.lang, "ko");
});

test("제거 — 우아한형제들 (Cloudflare WAF가 모든 자동화 클라이언트를 403으로 차단)", () => {
  assert.equal(findFeed("https://techblog.woowahan.com/feed/"), undefined);
});

test("Phase 1: COMMUNITY 추가 — Show HN", () => {
  const feed = findFeed("https://hnrss.org/show?points=30&count=20");
  assert.ok(feed, "Show HN feed should exist");
  assert.equal(feed.tier, "COMMUNITY");
});

test("Phase 1: COMMUNITY 추가 — GitHub Trending", () => {
  const feed = findFeed("https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml");
  assert.ok(feed, "GitHub Trending feed should exist");
  assert.equal(feed.tier, "COMMUNITY");
});

test("Phase 1: P0 → P1 강등 — Google Research Blog", () => {
  const feed = findFeed("https://research.google/blog/rss/");
  assert.ok(feed, "Google Research Blog feed should still exist");
  assert.equal(feed.tier, "P1_CONTEXT", "should be demoted to P1");
});

test("Phase 1: P0 → P1 강등 — MIT Technology Review", () => {
  const feed = findFeed("https://www.technologyreview.com/feed/");
  assert.ok(feed, "MIT Technology Review feed should still exist");
  assert.equal(feed.tier, "P1_CONTEXT", "should be demoted to P1");
});

test("Phase 1: 제거 — LogRocket Blog (마케팅 편향)", () => {
  const feed = findFeed("https://blog.logrocket.com/feed/");
  assert.equal(feed, undefined, "LogRocket Blog should be removed");
});

test("Phase 1: 제거 — Phoronix (AI 무관)", () => {
  const feed = findFeed("https://www.phoronix.com/rss.php");
  assert.equal(feed, undefined, "Phoronix should be removed");
});

test("Phase 1: 제거 — Product Hunt RSS (GraphQL 경로와 중복)", () => {
  const feed = findFeed("https://www.producthunt.com/feed");
  assert.equal(feed, undefined, "Product Hunt RSS should be removed (use GraphQL source)");
});

test("Phase 1: 제거 — HackerNews AI hnrss (hn_source.ts와 중복)", () => {
  const feed = findFeed("https://hnrss.org/newest?q=LLM+AI");
  assert.equal(feed, undefined, "HackerNews AI hnrss should be removed");
});

test("Phase 1: 한국어 매체 비중 ≥15% (PRD §3.1 목표 — 우아한·요즘IT 외부 폐지로 18%→15% 완화)", () => {
  const koFeeds = RSS_FEEDS.filter((f) => f.lang === "ko");
  const ratio = koFeeds.length / RSS_FEEDS.length;
  assert.ok(
    ratio >= 0.15,
    `한국어 비중 ${(ratio * 100).toFixed(1)}% — 15% 이상이어야 함 (현재 ${koFeeds.length}/${RSS_FEEDS.length})`
  );
});

test("Phase 1: 전체 피드 수 (40~50 범위)", () => {
  assert.ok(
    RSS_FEEDS.length >= 40 && RSS_FEEDS.length <= 50,
    `RSS_FEEDS.length = ${RSS_FEEDS.length} (40~50 범위 기대)`
  );
});

test("Phase 1: 추가 한국 매체 3종(네이버 D2 / 카카오 / LINE) 존재", () => {
  for (const url of [
    "https://d2.naver.com/d2.atom",
    "https://tech.kakao.com/feed/",
    "https://engineering.linecorp.com/ko/feed/",
  ]) {
    const feed = findFeed(url);
    assert.ok(feed, `한국 RSS ${url} 누락`);
    assert.equal(feed.lang, "ko");
  }
});
