import assert from "node:assert/strict";
import test from "node:test";
import { buildRewritePrompt, buildCommunityRewritePrompt } from "./expert-picks-tuning";

test("rewrite prompt forbids reusing the original wording/structure and fabricating facts", () => {
  const { system } = buildRewritePrompt("제목", "아무 텍스트");
  assert.match(system, /사실관계/);
  assert.match(system, /연속 7단어/);
  assert.match(system, /같은 문단 순서/);
  assert.match(system, /새로 만들어내기/);
});

test("rewrite prompt requires a freshly written title, not a copy of the original", () => {
  const { system } = buildRewritePrompt("제목", "아무 텍스트");
  assert.match(system, /제목을 베끼거나 다듬지 말고/);
});

test("rewrite prompt requires strict JSON output", () => {
  const { system } = buildRewritePrompt("제목", "아무 텍스트");
  assert.match(system, /"title"/);
  assert.match(system, /"body"/);
});

test("rewrite prompt embeds the original title and body verbatim in the user message", () => {
  const bodyKo = "오픈AI가\n새 모델을 발표했다.";
  const { user } = buildRewritePrompt("오픈AI 새 모델", bodyKo);
  assert.match(user, /오픈AI 새 모델/);
  assert.match(user, /오픈AI가\n새 모델을 발표했다\./);
});

test("community rewrite prompt has no title concept — output is body-only JSON", () => {
  const { system } = buildCommunityRewritePrompt("아무 텍스트");
  assert.match(system, /"body"/);
  assert.doesNotMatch(system, /"title"/);
});

test("community rewrite prompt preserves facts but keeps a casual community tone, unlike the expert-pick rewriter", () => {
  const { system } = buildCommunityRewritePrompt("아무 텍스트");
  assert.match(system, /사실관계/);
  assert.match(system, /캐주얼한 어조/);
});

test("community rewrite prompt embeds the original body verbatim in the user message", () => {
  const bodyKo = "오늘 진짜 대박 소식 들음ㅋㅋ";
  const { user } = buildCommunityRewritePrompt(bodyKo);
  assert.equal(user, bodyKo);
});
