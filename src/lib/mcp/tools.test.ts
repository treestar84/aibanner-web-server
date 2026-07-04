import test from "node:test";
import assert from "node:assert/strict";

import { buildMeta, toolError, toolSuccess, truncate } from "@/lib/mcp/policy";

test("truncate keeps short text untouched", () => {
  assert.equal(truncate("짧은 요약", 200), "짧은 요약");
  assert.equal(truncate(null, 200), "");
  assert.equal(truncate(undefined, 200), "");
});

test("truncate cuts long text and appends ellipsis", () => {
  const long = "가".repeat(250);
  const result = truncate(long, 200);
  assert.equal(result.length, 200);
  assert.ok(result.endsWith("…"));
});

test("buildMeta always marks summaries as AI generated and includes takedown contact", () => {
  const meta = buildMeta("ko");
  assert.equal(meta.summaries_are_ai_generated, true);
  assert.equal(meta.lang, "ko");
  assert.equal(meta.takedown_contact, "angelyrlove40@gmail.com");
  assert.ok(meta.attribution.length > 0);
  assert.ok(!Number.isNaN(new Date(meta.generated_at).getTime()));
});

test("toolSuccess wraps data with { data, meta } and serializes as single text content", () => {
  const result = toolSuccess({ items: [{ keyword: "GPT-5" }] }, "ko");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.isError, undefined);

  const parsed = JSON.parse(result.content[0].text);
  assert.deepEqual(parsed.data, { items: [{ keyword: "GPT-5" }] });
  assert.equal(parsed.meta.lang, "ko");
});

test("toolError marks isError true and never leaks a stack trace", () => {
  const result = toolError("지금은 트렌드 데이터를 불러올 수 없어요. 잠시 후 다시 시도해주세요.");
  assert.equal(result.isError, true);
  assert.equal(
    result.content[0].text,
    "지금은 트렌드 데이터를 불러올 수 없어요. 잠시 후 다시 시도해주세요."
  );
  assert.ok(!result.content[0].text.includes("at "));
});

test("toolSuccess response never includes snippet or image fields (copyright policy)", () => {
  const data = {
    items: [{ keyword: "Sora 2", summary: "요약", source: { name: "제목", url: "https://example.com" } }],
  };
  const result = toolSuccess(data, "ko");
  const serialized = result.content[0].text;

  assert.ok(!serialized.toLowerCase().includes("snippet"));
  assert.ok(!serialized.toLowerCase().includes("image_url"));
  assert.ok(!serialized.toLowerCase().includes("imageurl"));
});

test("toolSuccess response for keyword-shaped payloads never includes snippet/imageUrl even when sources are nested", () => {
  const data = {
    found: true,
    keyword: "Claude Fable 5",
    summary: "요약",
    bullets: ["설명1", "설명2"],
    sources: [
      { type: "news", name: "출처 제목", url: "https://example.com/a", domain: "example.com" },
      { type: "social", name: "커뮤니티 글", url: "https://example.com/b", domain: "example.com" },
    ],
  };
  const result = toolSuccess(data, "ko");
  const serialized = result.content[0].text;

  assert.ok(!serialized.toLowerCase().includes("snippet"));
  assert.ok(!serialized.toLowerCase().includes("image_url"));
  assert.ok(!serialized.toLowerCase().includes("imageurl"));
  // sources must only carry {type, name, url, domain} — no extra leakage
  const parsed = JSON.parse(serialized);
  for (const source of parsed.data.sources) {
    assert.deepEqual(Object.keys(source).sort(), ["domain", "name", "type", "url"]);
  }
});
