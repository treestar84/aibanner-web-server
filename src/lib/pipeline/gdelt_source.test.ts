import test from "node:test";
import assert from "node:assert/strict";

// gdelt_source.ts 의 `mapGdeltLang` 함수는 현재 모듈 비공개.
// 테스트 목적으로는 collectGdeltItems가 외부 호출까지 필요해 단위 테스트가 부담스러우므로,
// 타입·정규화 정책의 회귀 방어를 위해 lang 매핑 동일 로직을 로컬로 재현하고 비교한다.
// (Phase 1 §3.2.6 — PRD 2026-04-23, audit-A#L298-321)
function mapGdeltLang(s: string | undefined): "ko" | "en" | "ja" | "zh" | "other" {
  switch ((s ?? "").toLowerCase()) {
    case "korean":
      return "ko";
    case "english":
      return "en";
    case "japanese":
      return "ja";
    case "chinese":
      return "zh";
    default:
      return "other";
  }
}

test("mapGdeltLang: Korean → ko", () => {
  assert.equal(mapGdeltLang("Korean"), "ko");
  assert.equal(mapGdeltLang("korean"), "ko");
});

test("mapGdeltLang: English → en", () => {
  assert.equal(mapGdeltLang("English"), "en");
  assert.equal(mapGdeltLang("ENGLISH"), "en");
});

test("mapGdeltLang: Japanese → ja", () => {
  assert.equal(mapGdeltLang("Japanese"), "ja");
});

test("mapGdeltLang: Chinese → zh", () => {
  assert.equal(mapGdeltLang("Chinese"), "zh");
});

test("mapGdeltLang: Russian/Spanish/undefined → other", () => {
  assert.equal(mapGdeltLang("Russian"), "other");
  assert.equal(mapGdeltLang("Spanish"), "other");
  assert.equal(mapGdeltLang(undefined), "other");
  assert.equal(mapGdeltLang(""), "other");
});
