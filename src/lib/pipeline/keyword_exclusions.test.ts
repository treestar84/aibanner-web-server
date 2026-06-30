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

// ─── prefix 규칙 ────────────────────────────────────────────────────────────

test("isExcludedKeyword: Show HN: 접두사 키워드는 차단된다", () => {
  assert.equal(isExcludedKeyword("Show HN: slash-agent"), true);
  assert.equal(isExcludedKeyword("Show HN: My New Tool"), true);
  assert.equal(isExcludedKeyword("show hn: Modeloop"), true);
  assert.equal(isExcludedKeyword("Modeloop"), false, "Show HN 없이는 통과");
});

// ─── regex 규칙 ─────────────────────────────────────────────────────────────

test("isExcludedKeyword: owner/repo + 버전 패턴은 차단된다", () => {
  assert.equal(isExcludedKeyword("vercel/ai ai@6.0.209"), true);
  assert.equal(isExcludedKeyword("ggml-org/llama.cpp b9775"), true);
  assert.equal(isExcludedKeyword("anthropics/claude-code v2.1.186"), true);
  assert.equal(isExcludedKeyword("BerriAI/litellm v1.89.4"), true);
});

test("isExcludedKeyword: pip ==version 패턴은 차단된다", () => {
  assert.equal(isExcludedKeyword("langchain==1.3.10"), true);
  assert.equal(isExcludedKeyword("langchain-openrouter==0.2.4"), true);
});

test("isExcludedKeyword: Claude Code 3자리 이상 패치 버전은 차단된다", () => {
  assert.equal(isExcludedKeyword("Claude Code v2.1.185"), true);
  assert.equal(isExcludedKeyword("Anthropic Claude v2.1.193"), true);
  assert.equal(isExcludedKeyword("Claude Code v2.1.0"), false, "한 자리 패치는 허용");
  assert.equal(isExcludedKeyword("Claude Code v3.0.0"), false, "패치 0인 주요 버전은 허용");
});

test("isExcludedKeyword: 3분절 이상 kebab-case 개인 레포명은 차단된다", () => {
  assert.equal(isExcludedKeyword("mcp-gateway-registry"), true);
  assert.equal(isExcludedKeyword("claude-code-session-bridge"), true);
  assert.equal(isExcludedKeyword("laravel-fastapi-demo"), true);
  assert.equal(isExcludedKeyword("claude-code"), false, "2분절은 허용");
  assert.equal(isExcludedKeyword("langchain-openrouter"), false, "2분절은 허용");
});

// ─── Category 5 추상 개념어 exact 차단 ───────────────────────────────────────

test("isExcludedKeyword: Category 5 추상 개념어는 차단된다", () => {
  assert.equal(isExcludedKeyword("AI 에이전트 CLI 도구"), true);
  assert.equal(isExcludedKeyword("에이전트 하네스"), true);
  assert.equal(isExcludedKeyword("RAG 구현"), true);
  assert.equal(isExcludedKeyword("루프 엔지니어링"), true);
  assert.equal(isExcludedKeyword("Codex 하네스 활용"), true);
  assert.equal(isExcludedKeyword("AI 컨텍스트 레이어"), true);
});

// ─── Realtime broad topic 차단 ───────────────────────────────────────────────

test("isExcludedKeyword: 최근 운영에서 반복 노출된 broad topic exact 표면은 차단된다", () => {
  // Given: 실시간 키워드로 부적합한 evergreen/broad topic 표면들.
  const broadTopics = [
    "MCP",
    "MCP server",
    "mcp-server",
    "AI coding agent",
    "AI coding agents",
    "AI 코딩 에이전트",
    "Vibe coding",
    "바이브 코딩",
    "바이브코딩",
    "AI agent infrastructure",
    "RAG System",
    "RAG 시스템",
  ];

  // When / Then: 하이픈, 복수형, 한글 띄어쓰기 차이를 흡수해 차단한다.
  assert.deepEqual(
    broadTopics.map((keyword) => [keyword, isExcludedKeyword(keyword)]),
    broadTopics.map((keyword) => [keyword, true])
  );
});

test("isExcludedKeyword: broad topic을 포함해도 구체 앵커가 있으면 차단하지 않는다", () => {
  // Given: broad topic 주변에 제품명, 버전, 구체 기능/아키텍처 앵커가 붙은 키워드.
  const anchoredKeywords = [
    "Claude Code MCP",
    "MCP Server Architecture",
    "LangChain RAG",
    "Agentic RAG",
    "Cursor for iOS",
    "Gemini CLI",
    "Claude Code v2.1.0",
  ];

  // When / Then: 부분 문자열 매칭으로 중요한 구체 키워드를 제거하지 않는다.
  assert.deepEqual(
    anchoredKeywords.map((keyword) => [keyword, isExcludedKeyword(keyword)]),
    anchoredKeywords.map((keyword) => [keyword, false])
  );
});

// ─── prefix/regex 비간섭 검증 (기존 호환) ───────────────────────────────────

test("isExcludedKeyword: prefix/regex가 무관한 키워드는 통과한다", () => {
  assert.equal(isExcludedKeyword("ai agent framework"), false);
  assert.equal(isExcludedKeyword("chatgpt 5.0 release"), false);
});
