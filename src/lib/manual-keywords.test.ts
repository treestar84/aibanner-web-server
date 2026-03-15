import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManualKeywordId,
  buildExtendedManualKeywordWindow,
  buildManualKeywordWindow,
  filterActiveSnapshotKeywords,
  isManualKeywordId,
  parseManualKeywordTtlHours,
} from "@/lib/manual-keywords";

test("parseManualKeywordTtlHours accepts allowed ttl values", () => {
  assert.deepEqual(parseManualKeywordTtlHours(6), { ttlHours: 6 });
  assert.deepEqual(parseManualKeywordTtlHours("12"), { ttlHours: 12 });
  assert.deepEqual(parseManualKeywordTtlHours(24), { ttlHours: 24 });
});

test("parseManualKeywordTtlHours rejects unsupported ttl values", () => {
  assert.deepEqual(parseManualKeywordTtlHours(5), {
    error: "ttlHours must be one of: 6, 12, 24",
  });
  assert.deepEqual(parseManualKeywordTtlHours("abc"), {
    error: "ttlHours must be a number",
  });
});

test("buildManualKeywordId normalizes whitespace and casing", () => {
  const a = buildManualKeywordId("realtime", " ElevenLabs   Flows ");
  const b = buildManualKeywordId("realtime", "elevenlabs flows");

  assert.equal(a, b);
  assert.equal(isManualKeywordId(a), true);
  assert.equal(isManualKeywordId("openai_gpt_5"), false);
});

test("filterActiveSnapshotKeywords drops inactive manual keywords only", () => {
  const activeId = buildManualKeywordId("realtime", "ElevenLabs Flows");
  const inactiveId = buildManualKeywordId("realtime", "Hidden Keyword");

  const items = [
    { keyword_id: activeId, rank: 1 },
    { keyword_id: inactiveId, rank: 2 },
    { keyword_id: "openclaw", rank: 3 },
  ];

  assert.deepEqual(
    filterActiveSnapshotKeywords(items, new Set([activeId])),
    [
      { keyword_id: activeId, rank: 1 },
      { keyword_id: "openclaw", rank: 3 },
    ]
  );
});

test("buildManualKeywordWindow creates a fresh ttl window from now", () => {
  const now = new Date("2026-03-15T00:00:00.000Z");
  const window = buildManualKeywordWindow(12, now);

  assert.equal(window.startsAt, "2026-03-15T00:00:00.000Z");
  assert.equal(window.expiresAt, "2026-03-15T12:00:00.000Z");
});

test("buildExtendedManualKeywordWindow adds ttl on top of remaining active time", () => {
  const now = new Date("2026-03-15T00:00:00.000Z");
  const window = buildExtendedManualKeywordWindow(
    {
      enabled: true,
      startsAt: "2026-03-14T20:00:00.000Z",
      expiresAt: "2026-03-15T05:00:00.000Z",
    },
    24,
    now
  );

  assert.equal(window.startsAt, "2026-03-14T20:00:00.000Z");
  assert.equal(window.expiresAt, "2026-03-16T05:00:00.000Z");
});

test("buildExtendedManualKeywordWindow restarts ttl when keyword is expired", () => {
  const now = new Date("2026-03-15T00:00:00.000Z");
  const window = buildExtendedManualKeywordWindow(
    {
      enabled: true,
      startsAt: "2026-03-14T10:00:00.000Z",
      expiresAt: "2026-03-14T23:00:00.000Z",
    },
    6,
    now
  );

  assert.equal(window.startsAt, "2026-03-15T00:00:00.000Z");
  assert.equal(window.expiresAt, "2026-03-15T06:00:00.000Z");
});
