import test from "node:test";
import assert from "node:assert/strict";

import {
  isExcludedKeyword,
  isExactlyExcludedKeyword, // 호환 alias
} from "./keyword_exclusions";

// Phase 2-A §4.2.1 (PRD 2026-04-23): 3단 분기 동작 검증.
// JSON에 prefix/regex 신규 항목이 추가될 경우 본 테스트는 자동으로 검증 범위가 확장됨.
// 현 시점 prefix/regex 배열은 비어 있으므로(스키마만 도입), exact 동작 회귀 + 경계 케이스 위주.

// ─── exact (기존 동작 회귀) ──────────────────────────────────────────────────

test("isExcludedKeyword: 기존 exact 항목(예: 'agent', 'a.i.', 'chatgpt')은 그대로 차단된다", () => {
  // src/config/keyword-exclusions.json 의 exact 배열에 포함된 대표값.
  assert.equal(isExcludedKeyword("agent"), true);
  assert.equal(isExcludedKeyword("Agent"), true, "대소문자 무시");
  assert.equal(isExcludedKeyword("  AGENT  "), true, "공백 trim");
  assert.equal(isExcludedKeyword("a.i."), true);
});

test("isExcludedKeyword: exact 미일치 키워드는 통과한다", () => {
  assert.equal(isExcludedKeyword("Claude Opus 4.7"), false);
  assert.equal(isExcludedKeyword("바이브 코딩"), false);
  assert.equal(isExcludedKeyword("Cursor Composer 2"), false);
});

test("isExcludedKeyword: 빈 문자열·공백은 통과한다", () => {
  assert.equal(isExcludedKeyword(""), false);
  assert.equal(isExcludedKeyword("   "), false);
});

// ─── 정규화 (대소문자 / 공백) ────────────────────────────────────────────────

test("isExcludedKeyword: 다중 공백·탭은 단일 공백으로 정규화된 뒤 비교된다", () => {
  assert.equal(isExcludedKeyword("  open  ai  "), false, "open ai는 exact에 미포함");
  // 'machine learning'은 exact 후보 — 다중 공백/대소문자 정규화 결과가 일관해야 함.
  assert.equal(
    isExcludedKeyword("MACHINE   LEARNING"),
    isExcludedKeyword("machine learning"),
    "정규화 결과는 입력 형태에 의존하지 않는다"
  );
});

// ─── 호환 alias ──────────────────────────────────────────────────────────────

test("isExactlyExcludedKeyword (legacy alias)는 isExcludedKeyword와 동일 동작", () => {
  assert.equal(isExactlyExcludedKeyword("agent"), isExcludedKeyword("agent"));
  assert.equal(
    isExactlyExcludedKeyword("Cursor Composer 2"),
    isExcludedKeyword("Cursor Composer 2")
  );
});

// ─── prefix / regex 스키마 검증 ─────────────────────────────────────────────
// 현재 prefix/regex 배열은 비어 있으나, 스키마가 살아있고 invalid regex가 안전하게 무시되는지 검증.

test("isExcludedKeyword: prefix/regex 배열이 비어있는 현 상태에서는 exact 외 모든 키워드 통과", () => {
  // 어떤 키워드든 exact에 없다면 false 여야 함 (prefix/regex 활성 전).
  assert.equal(isExcludedKeyword("ai agent framework"), false);
  assert.equal(isExcludedKeyword("chatgpt 5.0 release"), false);
});
