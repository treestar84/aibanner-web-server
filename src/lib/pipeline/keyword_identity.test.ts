import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAliasKey,
  compactAliasKey,
  buildAliasLookupKeys,
  collectAliasLookupKeys,
  resolveCanonicalKeywordIds,
} from "@/lib/pipeline/keyword_identity";
import type { NormalizedKeyword } from "@/lib/pipeline/keywords";

function makeKeyword(overrides: Partial<NormalizedKeyword>): NormalizedKeyword {
  return {
    keywordId: "kw_default",
    keyword: "Default Keyword",
    aliases: [],
    candidates: {
      text: "Default Keyword",
      count: 1,
      domains: new Set(["example.com"]),
      matchedItems: new Set([0]),
      latestAt: new Date("2026-07-01T00:00:00Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
    ...overrides,
  };
}

test("normalizeAliasKey lowercases, NFKC-normalizes, and collapses whitespace", () => {
  assert.equal(normalizeAliasKey("  Gemini   CLI  "), "gemini cli");
  assert.equal(normalizeAliasKey("MCP-Server"), "mcp-server");
});

test("compactAliasKey strips all whitespace after normalizing", () => {
  assert.equal(compactAliasKey("바이브 코딩"), "바이브코딩");
  assert.equal(compactAliasKey("바이브코딩"), "바이브코딩");
});

test("buildAliasLookupKeys returns both spaced and compact forms without duplicates", () => {
  assert.deepEqual(buildAliasLookupKeys("바이브 코딩"), ["바이브 코딩", "바이브코딩"]);
  assert.deepEqual(buildAliasLookupKeys("바이브코딩"), ["바이브코딩"]);
});

test("buildAliasLookupKeys drops keys shorter than 2 chars", () => {
  assert.deepEqual(buildAliasLookupKeys("a"), []);
});

test("collectAliasLookupKeys gathers keys from keyword text and its aliases", () => {
  const keywords = [
    makeKeyword({ keyword: "Gemini CLI", aliases: ["제미나이 CLI"] }),
    makeKeyword({ keywordId: "kw_2", keyword: "바이브 코딩", aliases: [] }),
  ];
  const keys = collectAliasLookupKeys(keywords);
  assert.equal(keys.includes("gemini cli"), true);
  assert.equal(keys.includes("제미나이 cli"), true);
  assert.equal(keys.includes("바이브 코딩"), true);
  assert.equal(keys.includes("바이브코딩"), true);
});

test("resolveCanonicalKeywordIds remaps a keyword whose alias matches an existing canonical ID", () => {
  const keywords = [makeKeyword({ keywordId: "kw_today_hash", keyword: "바이브코딩" })];
  const aliasMap = new Map([["바이브코딩", "kw_20260615_vibecoding"]]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 1);
  assert.equal(resolved[0].keywordId, "kw_20260615_vibecoding");
  assert.equal(resolved[0].keyword, "바이브코딩");
});

test("resolveCanonicalKeywordIds leaves a brand-new keyword's slug ID untouched", () => {
  const keywords = [makeKeyword({ keywordId: "kw_brand_new", keyword: "Some New Tool" })];

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, new Map());

  assert.equal(remappedCount, 0);
  assert.equal(resolved[0].keywordId, "kw_brand_new");
});

test("resolveCanonicalKeywordIds does not remap when the match already equals the current ID", () => {
  const keywords = [makeKeyword({ keywordId: "kw_same", keyword: "Gemini CLI" })];
  const aliasMap = new Map([["gemini cli", "kw_same"]]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 0);
  assert.equal(resolved[0].keywordId, "kw_same");
});

test("resolveCanonicalKeywordIds never assigns the same canonical ID to two different same-day keywords", () => {
  const keywords = [
    makeKeyword({ keywordId: "kw_a", keyword: "MCP Server" }),
    makeKeyword({ keywordId: "kw_b", keyword: "MCP서버" }),
  ];
  // Both alias forms happen to point at the same historical canonical ID.
  const aliasMap = new Map([
    ["mcp server", "kw_history_mcp"],
    ["mcp서버", "kw_history_mcp"],
  ]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 1);
  const ids = resolved.map((k) => k.keywordId);
  assert.equal(ids.includes("kw_history_mcp"), true);
  assert.equal(new Set(ids).size, 2, "each resolved keyword must keep a distinct id");
});

test("resolveCanonicalKeywordIds preserves all other NormalizedKeyword fields", () => {
  const original = makeKeyword({ keywordId: "kw_x", keyword: "Gemini CLI", aliases: ["제미나이 CLI"] });
  const aliasMap = new Map([["gemini cli", "kw_history_gemini_cli"]]);

  const { resolved } = resolveCanonicalKeywordIds([original], aliasMap);

  assert.equal(resolved[0].keyword, original.keyword);
  assert.deepEqual(resolved[0].aliases, original.aliases);
  assert.equal(resolved[0].candidates, original.candidates);
});
