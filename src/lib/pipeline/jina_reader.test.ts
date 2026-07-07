import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchFullText,
  fetchTopSourceFullTexts,
} from "@/lib/pipeline/jina_reader";
import type { TavilySource } from "@/lib/pipeline/tavily";

function buildSource(overrides: Partial<TavilySource> = {}): TavilySource {
  return {
    title: "Example article",
    url: "https://example.com/article",
    domain: "example.com",
    snippet: "snippet",
    imageUrl: null,
    publishedAt: null,
    type: "news",
    ...overrides,
  };
}

test("fetchFullText returns null on non-2xx response", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

  try {
    const result = await fetchFullText("https://example.com/foo");
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchFullText returns null on empty body", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response("   ", { status: 200 })) as typeof fetch;

  try {
    const result = await fetchFullText("https://example.com/foo");
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchFullText caps response length to the default char limit (6000)", async () => {
  const originalFetch = global.fetch;
  const longText = "a".repeat(10_000);
  global.fetch = (async () => new Response(longText, { status: 200 })) as typeof fetch;

  try {
    const result = await fetchFullText("https://example.com/foo");
    assert.ok(result !== null);
    assert.equal(result!.length, 6000);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchFullText never throws, returns null on network error", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const result = await fetchFullText("https://example.com/foo");
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchTopSourceFullTexts returns [] when JINA_READER_ENABLED=false", async () => {
  const original = process.env.JINA_READER_ENABLED;
  process.env.JINA_READER_ENABLED = "false";

  try {
    const result = await fetchTopSourceFullTexts([buildSource()], 2);
    assert.deepEqual(result, []);
  } finally {
    process.env.JINA_READER_ENABLED = original;
  }
});

test("fetchTopSourceFullTexts skips youtube, pdf, and x.com URLs", async () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.JINA_READER_ENABLED;
  delete process.env.JINA_READER_ENABLED;

  const sources = [
    buildSource({ url: "https://www.youtube.com/watch?v=abc", domain: "youtube.com" }),
    buildSource({ url: "https://youtu.be/abc", domain: "youtu.be" }),
    buildSource({ url: "https://example.com/report.pdf", domain: "example.com" }),
    buildSource({ url: "https://x.com/someone/status/123", domain: "x.com" }),
  ];

  let fetchCalls = 0;
  global.fetch = (async () => {
    fetchCalls++;
    return new Response("should not be called", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await fetchTopSourceFullTexts(sources, 4);
    assert.deepEqual(result, []);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    process.env.JINA_READER_ENABLED = originalEnabled;
  }
});

test("fetchTopSourceFullTexts keeps only texts >= 300 chars", async () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.JINA_READER_ENABLED;
  delete process.env.JINA_READER_ENABLED;

  const sources = [
    buildSource({ url: "https://example.com/long", domain: "example.com" }),
    buildSource({ url: "https://example.com/short", domain: "example.com" }),
  ];

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/long")) {
      return new Response("x".repeat(500), { status: 200 });
    }
    return new Response("too short", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await fetchTopSourceFullTexts(sources, 2);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://example.com/long");
  } finally {
    global.fetch = originalFetch;
    process.env.JINA_READER_ENABLED = originalEnabled;
  }
});
