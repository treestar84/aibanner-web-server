import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import type { RssItem } from "@/lib/pipeline/rss";
import { buildEventContext, toOriginSources } from "@/lib/pipeline/event_context";

function buildKeyword(matchedItems: number[]): NormalizedKeyword {
  return {
    keywordId: "keyword_1",
    keyword: "Test Keyword",
    aliases: [],
    candidates: {
      text: "Test Keyword",
      count: matchedItems.length,
      domains: new Set(["example.com"]),
      matchedItems: new Set(matchedItems),
      latestAt: new Date("2026-06-07T00:00:00.000Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
  };
}

function buildItem(overrides: Partial<RssItem> & { title: string; link: string }): RssItem {
  return {
    title: overrides.title,
    link: overrides.link,
    publishedAt: overrides.publishedAt ?? new Date("2026-06-07T00:00:00.000Z"),
    summary: overrides.summary ?? "summary text",
    sourceDomain: overrides.sourceDomain ?? "example.com",
    feedTitle: overrides.feedTitle ?? "Example Feed",
    tier: overrides.tier ?? "P1_CONTEXT",
    lang: overrides.lang ?? "en",
  };
}

test("buildEventContext sorts articles by tier order", () => {
  const items: RssItem[] = [
    buildItem({ title: "Raw item", link: "https://a.com/1", tier: "P2_RAW" }),
    buildItem({ title: "Curated item", link: "https://b.com/1", tier: "P0_CURATED" }),
    buildItem({ title: "Context item", link: "https://c.com/1", tier: "P1_CONTEXT" }),
  ];
  const keyword = buildKeyword([0, 1, 2]);

  const context = buildEventContext(keyword, items);

  assert.deepEqual(
    context.articles.map((article) => article.title),
    ["Curated item", "Context item", "Raw item"]
  );
});

test("buildEventContext caps at 5 articles", () => {
  const items: RssItem[] = Array.from({ length: 8 }, (_, index) =>
    buildItem({ title: `Item ${index}`, link: `https://a.com/${index}` })
  );
  const keyword = buildKeyword(items.map((_, index) => index));

  const context = buildEventContext(keyword, items);

  assert.equal(context.articles.length, 5);
});

test("buildEventContext dedupes by URL", () => {
  const items: RssItem[] = [
    buildItem({ title: "First", link: "https://a.com/1", tier: "P0_CURATED" }),
    buildItem({ title: "Duplicate", link: "https://a.com/1/", tier: "P1_CONTEXT" }),
  ];
  const keyword = buildKeyword([0, 1]);

  const context = buildEventContext(keyword, items);

  assert.equal(context.articles.length, 1);
  assert.equal(context.articles[0].title, "First");
});

test("buildEventContext ignores matchedItems indices out of range", () => {
  const items: RssItem[] = [buildItem({ title: "Only item", link: "https://a.com/1" })];
  const keyword = buildKeyword([0, 5, 10]);

  const context = buildEventContext(keyword, items);

  assert.equal(context.articles.length, 1);
  assert.equal(context.articles[0].title, "Only item");
});

test("toOriginSources maps articles to origin-provider TavilySource", () => {
  const items: RssItem[] = [
    buildItem({
      title: "Launch announcement",
      link: "https://arxiv.org/abs/1234",
      sourceDomain: "arxiv.org",
    }),
  ];
  const keyword = buildKeyword([0]);
  const context = buildEventContext(keyword, items);

  const sources = toOriginSources(context);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].provider, "origin");
  assert.equal(sources[0].type, "data");
  assert.equal(sources[0].url, "https://arxiv.org/abs/1234");
  assert.equal(sources[0].imageUrl, null);
});
