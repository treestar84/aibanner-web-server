import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSourceQuality } from "@/lib/pipeline/source_quality";

test("evaluateSourceQuality rejects irrelevant Gemini CLI HR articles", () => {
  const result = evaluateSourceQuality({
    keyword: "Gemini CLI",
    title: "AI와 대화로 채용 업무 자동화, 나인하이어 MCP 연동 출시",
    snippet: "인사 담당자를 위한 채용 자동화 기능과 MCP 연동을 소개합니다.",
    url: "https://www.asiatime.co.kr/article/20260604500171",
    domain: "asiatime.co.kr",
    provider: "naver",
    category: "news",
  });

  assert.equal(result.passesThreshold, false);
  assert.equal(result.reasons.includes("missing_anchor"), true);
});

test("evaluateSourceQuality rejects irrelevant dx-aem-flow finance sources", () => {
  const result = evaluateSourceQuality({
    keyword: "dx-aem-flow",
    title: "Kinross Gold Corporation latest stock news and headlines",
    snippet: "Yahoo Finance market updates and stock quote headlines.",
    url: "https://ca.finance.yahoo.com/quote/K.TO/news",
    domain: "ca.finance.yahoo.com",
    provider: "tavily",
    category: "news",
  });

  assert.equal(result.passesThreshold, false);
  assert.equal(result.reasons.includes("suspicious_domain"), true);
});

test("evaluateSourceQuality scores Ideogram official blog as high relevance", () => {
  const result = evaluateSourceQuality({
    keyword: "Ideogram 4.0",
    title: "Ideogram 4.0 technical report",
    snippet: "Introducing Ideogram 4.0 with improved image generation and layout control.",
    url: "https://ideogram.ai/blog/ideogram-4.0",
    domain: "ideogram.ai",
    provider: "tavily",
    category: "news",
  });

  assert.equal(result.passesThreshold, true);
  assert.equal(result.relevanceScore >= 0.8, true);
  assert.equal(result.reasons.includes("exact_phrase"), true);
});

test("evaluateSourceQuality keeps Korean sources with explicit Claude Code anchors", () => {
  const result = evaluateSourceQuality({
    keyword: "Claude Code",
    title: "클로드 코드와 Codex를 활용한 AI 코딩 워크플로우",
    snippet: "Claude Code 플러그인과 Codex 연동으로 개발 자동화를 개선합니다.",
    url: "https://news.hada.io/topic?id=12345",
    domain: "news.hada.io",
    provider: "naver",
    category: "social",
  });

  assert.equal(result.passesThreshold, true);
  assert.equal(result.reasons.includes("korean_context_anchor"), true);
});
