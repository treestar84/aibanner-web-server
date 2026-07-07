import test from "node:test";
import assert from "node:assert/strict";

import { exaSearch, isExaEnabled } from "@/lib/pipeline/exa_source";

test("isExaEnabled returns false when EXA_API_KEY is unset", () => {
  const original = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;

  try {
    assert.equal(isExaEnabled(), false);
  } finally {
    if (original !== undefined) process.env.EXA_API_KEY = original;
  }
});

test("isExaEnabled returns true when EXA_API_KEY is set", () => {
  const original = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";

  try {
    assert.equal(isExaEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = original;
  }
});

test("exaSearch returns [] without fetching when disabled", async () => {
  const originalKey = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await exaSearch("test query", { maxResults: 5, timeRange: "day" });
    assert.deepEqual(result, []);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.EXA_API_KEY = originalKey;
  }
});

test("exaSearch returns [] on non-2xx response", async () => {
  const originalKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response("error", { status: 500 })) as typeof fetch;

  try {
    const result = await exaSearch("test query", { maxResults: 5, timeRange: "day" });
    assert.deepEqual(result, []);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalKey;
  }
});

test("exaSearch maps results and drops entries without url", async () => {
  const originalKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Example",
            url: "https://example.com/a",
            text: "some content",
            publishedDate: "2026-07-01T00:00:00.000Z",
          },
          { title: "No url", text: "dropped" },
        ],
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const result = await exaSearch("test query", { maxResults: 5, timeRange: "week" });
    assert.deepEqual(result, [
      {
        title: "Example",
        url: "https://example.com/a",
        content: "some content",
        publishedDate: "2026-07-01T00:00:00.000Z",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalKey;
  }
});

test("exaSearch sends startPublishedDate derived from timeRange", async () => {
  const originalKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const originalFetch = global.fetch;

  let capturedBody: Record<string, unknown> | null = null;
  global.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await exaSearch("test query", { maxResults: 3, timeRange: "month" });
    assert.ok(capturedBody);
    assert.equal(typeof (capturedBody as Record<string, unknown>).startPublishedDate, "string");
    assert.ok(
      !Number.isNaN(
        Date.parse((capturedBody as Record<string, unknown>).startPublishedDate as string)
      )
    );
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalKey;
  }
});
