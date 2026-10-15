import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { withPipelineDiagnostics, withKeywordDiagnostics } from "./diagnostics";
import { extractOgImage } from "./og-parser";
import { fetchTopSourceFullTexts } from "./jina_reader";
import { collectNaverSources } from "./naver_search";
import { exaSearch } from "./exa_source";
import { filterByEventRelevance } from "./event_relevance_gate";
import { generateSummaries } from "./summarize";
import type { TavilySource } from "./tavily";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const source: TavilySource = { title: "Test model", url: "https://example.com/article", domain: "example.com", snippet: "same text", imageUrl: null, publishedAt: null, type: "news" };

async function observed<T>(enabled: boolean, work: () => Promise<T>, lines: string[] = []) {
  return withPipelineDiagnostics(() => withKeywordDiagnostics("test_model", work), { enabled, emit: (line) => lines.push(line) });
}

test("OG instrumentation preserves chosen URLs and one fetch with diagnostics off/on", async () => {
  const originalFetch = global.fetch;
  try {
    for (const [html, expected] of [
      ['<meta property="og:image" content="https://example.com/photo.jpg">', "https://example.com/photo.jpg"],
      ['<meta name="twitter:image" content="https://example.com/twitter.jpg">', "https://example.com/twitter.jpg"],
      ['<meta property="og:image" content="/photo.jpg"><link rel="icon" href="/favicon.ico">', "https://example.com/favicon.ico"],
      ["<html></html>", "/images/default-thumbnail.png"],
    ]) {
      const results: unknown[] = [];
      for (const enabled of [false, true]) {
        let calls = 0;
        global.fetch = (async () => { calls++; return new Response(html); }) as typeof fetch;
        results.push(await observed(enabled, () => extractOgImage(source.url)));
        assert.equal(calls, 1);
      }
      assert.deepEqual(results, [expected, expected]);
    }
  } finally { global.fetch = originalFetch; }
});

test("fulltext instrumentation preserves order, cutoff and two fetches off/on", async () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.JINA_READER_ENABLED;
  delete process.env.JINA_READER_ENABLED;
  try {
    const results = [];
    for (const enabled of [false, true]) {
      let calls = 0;
      global.fetch = (async (input) => {
        calls++;
        return new Response(String(input).endsWith("/short") ? "short" : "x".repeat(500));
      }) as typeof fetch;
      results.push(await observed(enabled, () => fetchTopSourceFullTexts([
        source, { ...source, url: "https://example.com/short" },
        { ...source, url: "https://youtube.com/watch?v=a", domain: "youtube.com" },
      ], 2)));
      assert.equal(calls, 2);
    }
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].length, 1);
    assert.equal(results[0][0].url, source.url);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("JINA_READER_ENABLED", originalEnabled);
  }
});

test("Naver instrumentation preserves three queries, results and HTTP fallback off/on", async () => {
  const originalFetch = global.fetch;
  const previousId = process.env.NAVER_CLIENT_ID;
  const previousSecret = process.env.NAVER_CLIENT_SECRET;
  process.env.NAVER_CLIENT_ID = "unit-test-id";
  process.env.NAVER_CLIENT_SECRET = "unit-test-secret";
  try {
    for (const status of [200, 429]) {
      const results = [];
      const requests: string[][] = [];
      for (const enabled of [false, true]) {
        const urls: string[] = [];
        global.fetch = (async (input) => {
          urls.push(String(input));
          return new Response(JSON.stringify({ items: [{ title: "Test", link: source.url, description: "same" }] }), { status });
        }) as typeof fetch;
        results.push(await observed(enabled, () => collectNaverSources("Test")));
        requests.push(urls);
        assert.equal(urls.length, 3);
      }
      assert.deepEqual(results[0], results[1]);
      assert.deepEqual(requests[0], requests[1]);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NAVER_CLIENT_ID", previousId);
    restoreEnv("NAVER_CLIENT_SECRET", previousSecret);
  }
});

test("Exa instrumentation preserves one call and fallback outputs off/on", async () => {
  const originalFetch = global.fetch;
  const previousKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "unit-test-key";
  try {
    for (const status of [200, 503]) {
      const results = [];
      for (const enabled of [false, true]) {
        let calls = 0;
        global.fetch = (async () => {
          calls++;
          return new Response(JSON.stringify({ results: [{ title: "same", url: source.url, text: "same" }] }), { status });
        }) as typeof fetch;
        results.push(await observed(enabled, () => exaSearch("Test", { maxResults: 2, timeRange: "day" })));
        assert.equal(calls, 1);
      }
      assert.deepEqual(results[0], results[1]);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnv("EXA_API_KEY", previousKey);
  }
});

test("AI instrumentation preserves relevance fail-open and summaries without extra calls", async () => {
  const originalPost = OpenAI.prototype.post;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "unit-test-key";
  const candidates = [source, { ...source, url: "https://example.com/second" }];
  try {
    for (const content of ['{"0":8,"1":2}', '{"0":8}', "not JSON", '{"summary":"same summary","bullets":["#same"]}']) {
      const results = [];
      const counts = [];
      for (const enabled of [false, true]) {
        let calls = 0;
        OpenAI.prototype.post = (async () => {
          calls++;
          return { choices: [{ message: { content } }] };
        }) as unknown as typeof originalPost;
        const result = content.includes("summary")
          ? await observed(enabled, () => generateSummaries("Test", candidates))
          : await observed(enabled, () => filterByEventRelevance("Test", "same event", candidates));
        results.push(result);
        counts.push(calls);
      }
      assert.deepEqual(results[0], results[1]);
      assert.equal(counts[0], counts[1]);
      if (!content.includes("summary")) assert.equal(counts[0], 1);
    }
  } finally {
    OpenAI.prototype.post = originalPost;
    restoreEnv("OPENAI_API_KEY", previousKey);
  }
});

test("summary fallback is preserved when the provider rejects with diagnostics on/off", async () => {
  const originalPost = OpenAI.prototype.post;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "unit-test-key";
  try {
    const results = [];
    OpenAI.prototype.post = (async () => { throw new Error("mock provider failed"); }) as unknown as typeof originalPost;
    for (const enabled of [false, true]) results.push(await observed(enabled, () => generateSummaries("Test", [source])));
    assert.deepEqual(results[0], results[1]);
  } finally {
    OpenAI.prototype.post = originalPost;
    restoreEnv("OPENAI_API_KEY", previousKey);
  }
});
