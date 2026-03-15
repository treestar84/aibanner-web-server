import test from "node:test";
import assert from "node:assert/strict";

import { buildManualKeywordFeedback } from "@/lib/manual-keyword-feedback";

test("buildManualKeywordFeedback formats create success message", () => {
  const feedback = buildManualKeywordFeedback({
    action: "create",
    item: {
      keyword: "ElevenLabs Flows",
      mode: "realtime",
      expires_at: "2026-03-15T06:00:00.000Z",
    },
    snapshot: {
      ok: true,
      mode: "realtime",
      snapshotId: "20260315_1500_KST",
      keywordCount: 10,
      reusedCount: 2,
    },
  });

  assert.equal(feedback.tone, "success");
  assert.match(feedback.message, /ElevenLabs Flows 등록 완료/);
  assert.match(feedback.message, /mode=realtime/);
  assert.match(feedback.message, /스냅샷 20260315_1500_KST 즉시 반영/);
});

test("buildManualKeywordFeedback formats extend message with previous and new expiry", () => {
  const feedback = buildManualKeywordFeedback({
    action: "extend",
    ttlHours: 12,
    previousItem: {
      keyword: "Gemini 3.0",
      mode: "realtime",
      expires_at: "2026-03-15T06:00:00.000Z",
    },
    item: {
      keyword: "Gemini 3.0",
      mode: "realtime",
      expires_at: "2026-03-15T18:00:00.000Z",
    },
    snapshot: {
      ok: true,
      mode: "realtime",
      snapshotId: "20260315_1510_KST",
      keywordCount: 10,
      reusedCount: 3,
    },
  });

  assert.equal(feedback.tone, "success");
  assert.match(feedback.message, /Gemini 3.0 \+12시간 연장 완료/);
  assert.match(feedback.message, /->/);
});

test("buildManualKeywordFeedback marks snapshot failures as warning", () => {
  const feedback = buildManualKeywordFeedback({
    action: "disable",
    item: {
      keyword: "Openclaw",
      mode: "briefing",
      expires_at: "2026-03-15T06:00:00.000Z",
    },
    snapshot: {
      ok: false,
      mode: "briefing",
      error: "snapshot failed",
    },
  });

  assert.equal(feedback.tone, "warning");
  assert.match(feedback.message, /Openclaw 비활성화 완료/);
  assert.match(feedback.message, /스냅샷 즉시 반영 실패 · snapshot failed/);
});

test("buildManualKeywordFeedback keeps existing expiry text on enable when expiry is unchanged", () => {
  const feedback = buildManualKeywordFeedback({
    action: "enable",
    previousItem: {
      keyword: "Codex CLI",
      mode: "realtime",
      expires_at: "2026-03-15T06:00:00.000Z",
    },
    item: {
      keyword: "Codex CLI",
      mode: "realtime",
      expires_at: "2026-03-15T06:00:00.000Z",
    },
    snapshot: {
      ok: true,
      mode: "realtime",
      snapshotId: "20260315_1520_KST",
      keywordCount: 9,
      reusedCount: 4,
    },
  });

  assert.equal(feedback.tone, "success");
  assert.match(feedback.message, /Codex CLI 재활성화 완료/);
  assert.match(feedback.message, /기존 만료 유지/);
});

test("buildManualKeywordFeedback formats delete message with keyword name", () => {
  const feedback = buildManualKeywordFeedback({
    action: "delete",
    deletedKeyword: "LangGraph",
    snapshot: {
      ok: true,
      mode: "realtime",
      snapshotId: "20260315_1530_KST",
      keywordCount: 8,
      reusedCount: 5,
    },
  });

  assert.equal(feedback.tone, "success");
  assert.match(feedback.message, /LangGraph 삭제 완료/);
  assert.match(feedback.message, /공개 목록에서 즉시 제외/);
});
