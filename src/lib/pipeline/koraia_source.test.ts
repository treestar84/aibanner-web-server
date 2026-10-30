import assert from "node:assert/strict";
import test from "node:test";
import { collectKoraiaItems, parseKoraiaItems } from "./koraia_source";
import type { safeFetchBytes } from "../safe-fetch";

const now = new Date("2026-10-31T00:00:00Z");
const cutoff = new Date("2026-10-30T00:00:00Z");
const row = { id: 1, title: "Claude Code 공개 | copied article excerpt", url: "https://example.com/news", created_at: "2026-10-30T15:50:00+09:00" };

test("KORAIA maps only headline metadata, drops duplicates and invalid or stale rows", () => {
  const result = parseKoraiaItems([row, { ...row, id: 2 }, null, {},
    { ...row, id: 3, title: "old", created_at: cutoff.toISOString() },
    { ...row, id: 4, title: "future", created_at: "2026-11-01T00:00:00Z" },
    { ...row, id: 5, title: "invalid", url: "javascript:alert(1)" },
    { ...row, id: 6, title: "bad date", created_at: "invalid" },
  ], cutoff, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Claude Code 공개");
  assert.equal(result[0].summary, "");
  assert.equal(result[0].keywordBoostSource, "koraia");
  assert.equal(result[0].sourceDomain, "report.koraia.org");
  assert.equal(result[0].link, "https://report.koraia.org/info#article-1");
  assert.throws(() => parseKoraiaItems({}, cutoff, now));
  assert.equal(parseKoraiaItems(Array.from({ length: 250 }, (_, i) => ({ ...row, id: i + 1, title: `title ${i}` })), cutoff, now).length, 200);
});

test("KORAIA makes two bounded requests, uses public config and filters by window", async () => {
  const calls: { url: string; options: Parameters<typeof safeFetchBytes>[1] }[] = [];
  const fetcher: typeof safeFetchBytes = async (url, options) => {
    calls.push({ url, options });
    const text = calls.length === 1
      ? "const SUPABASE_URL = 'https://kydkwdwtsqsjxasirxoi.supabase.co'; const SUPABASE_ANON_KEY = 'sb_publishable_test';"
      : JSON.stringify([row]);
    return { bytes: Buffer.from(text), contentType: calls.length === 1 ? "text/html" : "application/json", url };
  };
  const items = await collectKoraiaItems(24, fetcher, now);
  assert.equal(items.length, 1);
  assert.equal(calls.length, 2);
  const api = new URL(calls[1].url);
  assert.equal(api.searchParams.get("limit"), "200");
  assert.equal(api.searchParams.get("created_at"), `gte.${cutoff.toISOString()}`);
  assert.equal(calls[1].options?.headers?.apikey, "sb_publishable_test");
  assert.ok(calls.every((call) => call.options?.maxBytes && call.options?.timeoutMs));
});

test("KORAIA fails closed on changed endpoint, private keys, HTTP and invalid JSON", async () => {
  for (const html of ["", "SUPABASE_URL='https://evil.com'; SUPABASE_ANON_KEY='sb_publishable_test'",
    "SUPABASE_URL='https://kydkwdwtsqsjxasirxoi.supabase.co'; SUPABASE_ANON_KEY='sb_secret_private'"]) {
    let calls = 0;
    const items = await collectKoraiaItems(24, async (url) => {
      calls++;
      return { bytes: Buffer.from(html), contentType: "text/html", url };
    }, now);
    assert.deepEqual(items, []);
    assert.equal(calls, 1);
  }
  assert.deepEqual(await collectKoraiaItems(24, async () => { throw new Error("HTTP 429"); }, now), []);
  let calls = 0;
  assert.deepEqual(await collectKoraiaItems(24, async (url) => {
    calls++;
    const text = calls === 1
      ? "SUPABASE_URL='https://kydkwdwtsqsjxasirxoi.supabase.co'; SUPABASE_ANON_KEY='sb_publishable_test'"
      : "not JSON";
    return { bytes: Buffer.from(text), contentType: "text/html", url };
  }, now), []);
  assert.equal(calls, 2);
});
