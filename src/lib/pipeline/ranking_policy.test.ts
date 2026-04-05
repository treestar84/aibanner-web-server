import test from "node:test";
import assert from "node:assert/strict";

import type { NormalizedKeyword } from "@/lib/pipeline/keywords";
import {
  buildKeywordPolicyMap,
  calculateKeywordPolicyDelta,
  calculateStabilityDelta,
  classifyVersionKind,
  suppressVersionFamilyDuplicates,
} from "@/lib/pipeline/ranking_policy";
import type { RssItem } from "@/lib/pipeline/rss";

function buildSource(
  overrides: Partial<RssItem> = {}
): RssItem {
  return {
    title: "placeholder",
    link: "https://github.com/example/repo/releases/tag/v1.0.0",
    publishedAt: new Date("2026-03-28T00:00:00.000Z"),
    summary: "",
    sourceDomain: "github.com",
    feedTitle: "GitHub Release: example/repo",
    tier: "P1_CONTEXT",
    lang: "en",
    ...overrides,
  };
}

function buildKeyword(
  keywordId: string,
  keyword: string,
  matchedItems: number[],
  domain = "github.com"
): NormalizedKeyword {
  return {
    keywordId,
    keyword,
    aliases: [],
    candidates: {
      text: keyword,
      count: matchedItems.length,
      domains: new Set([domain]),
      matchedItems: new Set(matchedItems),
      latestAt: new Date("2026-03-28T00:00:00.000Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
  };
}

test("classifyVersionKind distinguishes build, patch, minor, and major releases", () => {
  assert.equal(classifyVersionKind("llama.cpp b8555"), "build");
  assert.equal(classifyVersionKind("vercel ai@6.0.141"), "patch");
  assert.equal(classifyVersionKind("Claude Opus 4.6"), "minor");
  assert.equal(classifyVersionKind("Vercel AI 6"), "major");
});

test("policy map prefers repo-derived family keys for GitHub release trains", () => {
  const items = [
    buildSource({
      title: "ggml-org/llama.cpp b8555: release notes",
      link: "https://github.com/ggml-org/llama.cpp/releases/tag/b8555",
      feedTitle: "GitHub Release: ggml-org/llama.cpp",
    }),
  ];
  const keywords = [
    buildKeyword("llama_cpp_b8555", "ggml-org llama.cpp b8555", [0]),
  ];

  const meta = buildKeywordPolicyMap(keywords, items).get("llama_cpp_b8555");
  assert.ok(meta);
  assert.equal(meta?.familyKey, "repo:ggml-org/llama.cpp");
  assert.equal(meta?.versionKind, "build");
});

test("calculateKeywordPolicyDelta penalizes weak patch/build releases and boosts feature events", () => {
  const patchKeyword = buildKeyword(
    "vercel_ai_6_0_141",
    "vercel ai 6.0.141",
    [0]
  );
  const featureKeyword = buildKeyword(
    "gemini_memory_import",
    "Google Gemini Memory Import",
    [1],
    "producthunt.com"
  );
  featureKeyword.candidates.domains = new Set(["producthunt.com", "openai.com"]);

  const metaMap = buildKeywordPolicyMap(
    [patchKeyword, featureKeyword],
    [
      buildSource({
        title: "vercel/ai 6.0.141",
        link: "https://github.com/vercel/ai/releases/tag/6.0.141",
        feedTitle: "GitHub Release: vercel/ai",
      }),
      buildSource({
        title: "Google Gemini Memory Import",
        link: "https://www.producthunt.com/posts/google-gemini-memory-import",
        sourceDomain: "producthunt.com",
        feedTitle: "Product Hunt Top Today",
      }),
    ]
  );

  const weakPatchDelta = calculateKeywordPolicyDelta(
    {
      keyword: patchKeyword,
      score: {
        authority: 0.6,
        engagement: 0.1,
      },
    },
    metaMap.get("vercel_ai_6_0_141")!
  );
  const featureDelta = calculateKeywordPolicyDelta(
    {
      keyword: featureKeyword,
      score: {
        authority: 0.84,
        engagement: 0.55,
      },
    },
    metaMap.get("gemini_memory_import")!
  );

  assert.ok(weakPatchDelta < 0);
  assert.ok(featureDelta > 0);
});

test("suppressVersionFamilyDuplicates keeps feature representatives and removes version siblings", () => {
  const sources = [
    buildSource({
      title: "vercel/ai 6.0.141",
      link: "https://github.com/vercel/ai/releases/tag/6.0.141",
      feedTitle: "GitHub Release: vercel/ai",
    }),
    buildSource({
      title: "vercel/ai-sdk-svelte 4.0.141",
      link: "https://github.com/vercel/ai/releases/tag/ai-sdk-svelte-4.0.141",
      feedTitle: "GitHub Release: vercel/ai",
    }),
    buildSource({
      title: "Vercel AI Memory Import",
      link: "https://github.com/vercel/ai/releases/tag/memory-import",
      feedTitle: "GitHub Release: vercel/ai",
    }),
  ];
  const keywords = [
    buildKeyword("vercel_ai_6_0_141", "vercel ai 6.0.141", [0]),
    buildKeyword("vercel_ai_sdk_svelte_4_0_141", "vercel ai-sdk svelte 4.0.141", [1]),
    buildKeyword("vercel_ai_memory_import", "Vercel AI Memory Import", [2]),
  ];
  const metaMap = buildKeywordPolicyMap(keywords, sources);

  const filtered = suppressVersionFamilyDuplicates(
    [
      { keyword: keywords[0], score: { total: 0.41 } },
      { keyword: keywords[1], score: { total: 0.39 } },
      { keyword: keywords[2], score: { total: 0.44 } },
    ],
    metaMap
  );

  assert.deepEqual(
    filtered.map((item) => item.keyword.keywordId),
    ["vercel_ai_memory_import"]
  );
});

test("calculateStabilityDelta rewards persistent incumbents and penalizes weak new arrivals", () => {
  const incumbent = {
    keyword: buildKeyword("claude_code", "Claude Code", [0], "claude.ai"),
    score: {
      recency: 0.62,
      velocity: 0.31,
      engagement: 0.42,
      authority: 0.84,
    },
    isNew: false,
  };
  const weakNew = {
    keyword: buildKeyword("llama_cpp_b8555", "llama.cpp b8555", [0]),
    score: {
      recency: 0.88,
      velocity: 0.12,
      engagement: 0.08,
      authority: 0.6,
    },
    isNew: true,
  };

  const incumbentDelta = calculateStabilityDelta(incumbent, {
    appearances: 3,
    previousRank: 4,
  });
  const weakNewDelta = calculateStabilityDelta(weakNew, {
    appearances: 0,
    previousRank: null,
  });

  assert.ok(incumbentDelta > 0);
  assert.ok(weakNewDelta < 0);
});
