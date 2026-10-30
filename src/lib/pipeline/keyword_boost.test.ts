import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { applyKeywordBoosts, normalizeKeywords, type NormalizedKeyword } from "./keywords";
import { buildEventContext, toOriginSources } from "./event_context";
import { isAllowedEvidence, isKeywordBoostDomain } from "./keyword_boost_policy";
import { filterRelevantSources } from "./tavily_source_selection";
import { calculateScore } from "./scoring";
import { buildKeywordPolicyMap, calculateKeywordPolicyDelta } from "./ranking_policy";
import { RSS_FEEDS, type RssItem } from "./rss";

const now = new Date("2026-10-31T00:00:00Z");
function item(source?: RssItem["keywordBoostSource"], title = "Claude Code update"): RssItem {
  const domain = source === "fiv" ? "fiv.co.kr" : source === "promppy" ? "www.promppy.com" : source === "koraia" ? "report.koraia.org" : "anthropic.com";
  return { title, link: `https://${domain}/${encodeURIComponent(title)}`, publishedAt: now,
    summary: "", sourceDomain: domain, feedTitle: domain, tier: "P1_CONTEXT", lang: "ko",
    ...(source ? { keywordBoostSource: source } : {}) };
}
function keyword(): NormalizedKeyword {
  return { keywordId: "claude_code", keyword: "Claude Code", aliases: ["클로드 코드"], candidates: {
    text: "Claude Code", count: 1, domains: new Set(["anthropic.com"]), matchedItems: new Set([0]),
    latestAt: now, tier: "P1_CONTEXT", domainBonus: 0, authorityOverride: 0,
  } };
}

test("boost mentions count once per site and preserve trusted evidence and scoring", () => {
  const original = keyword();
  const items = [item(), item("fiv"), item("fiv", "Claude Code another story"), item("promppy"), item("koraia")];
  const [boosted] = applyKeywordBoosts([original], items);
  assert.equal(boosted.candidates.count, 4);
  assert.equal(boosted.candidates.supplementalCount, 3);
  assert.equal(original.candidates.count, 1);
  assert.deepEqual(boosted.candidates.domains, original.candidates.domains);
  assert.deepEqual(boosted.candidates.matchedItems, original.candidates.matchedItems);
  assert.equal(boosted.candidates.latestAt, original.candidates.latestAt);
  const before = calculateScore(original, { sourceItems: items, now });
  const after = calculateScore(boosted, { sourceItems: items, now });
  for (const key of ["authority", "recency", "velocity", "engagement"] as const) assert.equal(after[key], before[key]);
  assert.equal(after.frequency, 0.175);
  assert.ok(after.total > before.total);
  assert.ok(after.total - before.total <= 0.0076);
  assert.deepEqual(buildEventContext(boosted, items).articles.map((article) => article.domain), ["anthropic.com"]);
  assert.equal(applyKeywordBoosts([boosted], items)[0].candidates.count, 4);
});

test("boosts match aliases and separators but not unrelated or partial model names", () => {
  assert.equal(applyKeywordBoosts([keyword()], [item("fiv", "클로드 코드 업데이트")])[0].candidates.supplementalCount, 1);
  assert.equal(applyKeywordBoosts([keyword()], [item("fiv", "Claude-Code update")])[0].candidates.supplementalCount, 1);
  assert.equal(applyKeywordBoosts([keyword()], [item("fiv", "Claude CodeX update")])[0].candidates.supplementalCount, undefined);
  const model = { ...keyword(), keyword: "GPT-5", aliases: [] };
  assert.equal(applyKeywordBoosts([model], [item("promppy", "GPT-5.5 update")])[0].candidates.supplementalCount, undefined);
  assert.deepEqual(applyKeywordBoosts([], [item("fiv")]), []);
});

test("supplemental counts cannot bypass low-evidence ranking penalties", () => {
  const original = keyword();
  original.candidates.tier = "P2_RAW";
  const items = [item(), item("fiv"), item("promppy"), item("koraia")];
  const [boosted] = applyKeywordBoosts([original], items);
  const meta = buildKeywordPolicyMap([original], items).get(original.keywordId)!;
  const score = { authority: 0.3, engagement: 0 };
  const before = calculateKeywordPolicyDelta({ keyword: original, score }, meta);
  assert.ok(before < 0);
  assert.equal(calculateKeywordPolicyDelta({ keyword: boosted, score }, meta), before);
});

test("supplemental-only inputs cannot create keywords or call keyword extraction", async () => {
  assert.deepEqual(await normalizeKeywords([item("fiv"), item("promppy"), item("koraia")]), []);
});

test("mixed normalization sends only regular titles to the LLM and preserves matching indices", async () => {
  const originalPost = OpenAI.prototype.post;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "unit-test-key";
  const requests: string[] = [];
  try {
    OpenAI.prototype.post = (async (_path: unknown, options: unknown) => {
      requests.push(JSON.stringify(options));
      return { choices: [{ message: { content: JSON.stringify([
        { keyword: "Claude Code 2.5", aliases: [] },
        { keyword: "OnlyInBooster", aliases: [] },
      ]) } }] };
    }) as unknown as typeof originalPost;
    const items = [item("fiv", "Claude Code 2.5 OnlyInBooster"), item(undefined, "Claude Code 2.5 update"), item("promppy", "Claude Code 2.5 update")];
    const result = await normalizeKeywords(items);
    assert.equal(requests.length, 1);
    assert.ok(!requests[0].includes("OnlyInBooster"));
    assert.equal(result.length, 1);
    assert.equal(result[0].keyword, "Claude Code 2.5");
    assert.equal(result[0].candidates.count, 3);
    assert.equal(result[0].candidates.supplementalCount, 2);
    assert.deepEqual([...result[0].candidates.matchedItems], [1]);
    assert.deepEqual([...result[0].candidates.domains], ["anthropic.com"]);
    assert.deepEqual(buildEventContext(result[0], items).articles.map((article) => article.domain), ["anthropic.com"]);
  } finally {
    OpenAI.prototype.post = originalPost;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("both official RSS feeds are explicitly configured for keyword boosts", () => {
  for (const [url, source] of [["https://fiv.co.kr/feed.xml", "fiv"], ["https://www.promppy.com/rss.xml", "promppy"]]) {
    assert.equal(RSS_FEEDS.find((feed) => feed.url === url)?.keywordBoostSource, source);
  }
});

test("boost items and unflagged aggregator URLs never become event or origin evidence", () => {
  const items = [item(), item("fiv"), item("promppy"), item("koraia")];
  delete items[1].keywordBoostSource;
  const kw = keyword();
  kw.candidates.matchedItems = new Set([0, 1, 2, 3]);
  const context = buildEventContext(kw, items);
  assert.equal(context.articles.length, 1);
  const injected = { ...context, articles: [...context.articles, { ...context.articles[0], url: "https://fiv.co.kr/news/1", domain: "fiv.co.kr" }] };
  assert.equal(toOriginSources(injected).length, 1);
});

test("search filtering excludes booster hosts for single and multiple word keywords", () => {
  const sources = [item(), item("fiv"), item("promppy"), item("koraia")].map((entry) => ({
    title: entry.title, url: entry.link, domain: entry.sourceDomain, snippet: "Claude Code update",
    publishedAt: now.toISOString(), imageUrl: null, type: "news" as const,
  }));
  for (const query of ["Claude", "Claude Code"]) {
    assert.deepEqual(filterRelevantSources(sources, query).map((source) => source.domain), ["anthropic.com"]);
  }
  assert.equal(isAllowedEvidence({ url: "https://www.promppy.com/item/1", domain: "trusted.com" }), false);
  assert.equal(isAllowedEvidence({ url: "https://trusted.com/1", domain: "report.koraia.org" }), false);
  assert.equal(isKeywordBoostDomain("FIV.CO.KR."), true);
  assert.equal(isKeywordBoostDomain("fiv.co.kr.evil.com"), false);
  assert.equal(isKeywordBoostDomain("koraia.org"), false);
});
