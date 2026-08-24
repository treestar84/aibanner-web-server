import assert from "node:assert/strict";
import test from "node:test";
import { parseExpertPickPaste, extractLinkDomain } from "./expert-picks-parser";

test("uses the first non-empty line as title, keeps full body with newlines intact", () => {
  const raw = "GPT-5.5 출시 임박\n\n오픈AI가 다음 주 발표를 예고했다.\n관련 링크: https://example.com/news?utm_source=kakao";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title, "GPT-5.5 출시 임박");
  assert.equal(result.body, raw.trim());
  assert.equal(result.linkUrl, "https://example.com/news?utm_source=kakao");
  assert.equal(result.linkDomain, "example.com");
});

test("skips leading blank lines to find the title", () => {
  const raw = "\n\n  \n첫 유효 줄이 제목\n본문 내용";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title, "첫 유효 줄이 제목");
});

test("truncates an overlong title to 100 chars without touching the body", () => {
  const longLine = "가".repeat(150);
  const raw = `${longLine}\n본문`;
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title.length, 100);
  assert.match(result.body, new RegExp(`^${longLine}`));
});

test("preserves multiple consecutive blank lines inside the body verbatim", () => {
  const raw = "제목\n\n\n\n중간에 빈 줄 여러 개\n\n마지막 문단";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.body, raw.trim());
});

test("returns empty link fields when no URL is present", () => {
  const result = parseExpertPickPaste("제목만 있는 글\n링크 없음");
  assert.equal(result.linkUrl, "");
  assert.equal(result.linkDomain, "");
});

test("picks the first of multiple URLs in the body", () => {
  const raw = "제목\nhttps://first.example.com/a\n더 보기 https://second.example.com/b";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.linkUrl, "https://first.example.com/a");
});

test("extractLinkDomain returns hostname for valid URLs and empty string for invalid input", () => {
  assert.equal(extractLinkDomain("https://sub.example.com/path"), "sub.example.com");
  assert.equal(extractLinkDomain("not a url"), "");
  assert.equal(extractLinkDomain(""), "");
});
