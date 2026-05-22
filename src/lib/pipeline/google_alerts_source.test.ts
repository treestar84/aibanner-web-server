import test from "node:test";
import assert from "node:assert/strict";

import {
  GOOGLE_ALERTS_FEEDS,
  getConfiguredGoogleAlertsFeeds,
} from "./google_alerts_source";

test("GOOGLE_ALERTS_FEEDS keeps recommended alert queries in code", () => {
  assert.ok(GOOGLE_ALERTS_FEEDS.length >= 6);
  assert.ok(GOOGLE_ALERTS_FEEDS.some((feed) => feed.query.includes("Claude Code")));
  assert.ok(GOOGLE_ALERTS_FEEDS.some((feed) => feed.query.includes("Grok")));
  assert.ok(GOOGLE_ALERTS_FEEDS.some((feed) => feed.query.includes("DeepSeek")));
  assert.ok(GOOGLE_ALERTS_FEEDS.some((feed) => feed.lang === "ko"));
});

test("getConfiguredGoogleAlertsFeeds ignores recommended queries until feed URLs are hardcoded", () => {
  assert.deepEqual(getConfiguredGoogleAlertsFeeds(), []);
});

test("getConfiguredGoogleAlertsFeeds accepts hardcoded feed objects", () => {
  const feeds = getConfiguredGoogleAlertsFeeds([
    {
      url: "https://www.google.com/alerts/feeds/example/gemini",
      query: "Gemini AI",
      title: "Gemini Alert",
      tier: "P1_CONTEXT",
      lang: "ko",
    },
  ]);

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].title, "Gemini Alert");
  assert.equal(feeds[0].query, "Gemini AI");
  assert.equal(feeds[0].tier, "P1_CONTEXT");
  assert.equal(feeds[0].lang, "ko");
});

test("getConfiguredGoogleAlertsFeeds deduplicates URLs and falls back invalid tier", () => {
  const feeds = getConfiguredGoogleAlertsFeeds([
    {
      url: "https://www.google.com/alerts/feeds/example/a",
      query: "A",
      title: "A",
      tier: "P0_CURATED" as never,
      lang: "en",
    },
    {
      url: "https://www.google.com/alerts/feeds/example/a",
      query: "A duplicate",
      title: "A duplicate",
      tier: "P1_CONTEXT",
      lang: "en",
    },
  ]);

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].title, "A");
  assert.equal(feeds[0].tier, "P2_RAW");
});
