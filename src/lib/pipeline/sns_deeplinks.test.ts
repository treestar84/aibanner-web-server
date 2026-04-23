import test from "node:test";
import assert from "node:assert/strict";

import { buildSnsDeeplinks } from "./sns_deeplinks";

test("buildSnsDeeplinks: 4개 SNS/검색 URL 모두 생성", () => {
  const links = buildSnsDeeplinks("Claude Opus 4.7");

  assert.match(links.x_search!, /^https:\/\/x\.com\/search\?q=.+&f=live$/);
  assert.match(links.threads_search!, /^https:\/\/www\.threads\.net\/search\?q=.+$/);
  assert.match(
    links.youtube_search!,
    /^https:\/\/www\.youtube\.com\/results\?search_query=.+$/
  );
  assert.match(
    links.github_search!,
    /^https:\/\/github\.com\/search\?q=.+&type=repositories$/
  );
});

test("buildSnsDeeplinks: 한국어 키워드도 안전하게 인코딩된다", () => {
  const links = buildSnsDeeplinks("바이브 코딩");
  // "바" → %EB%B0%94, " " → %20, "코" → %EC%BD%94 ...
  assert.match(links.x_search!, /q=%EB%B0%94/);
  assert.match(links.threads_search!, /%20/, "공백은 %20으로 인코딩");
});

test("buildSnsDeeplinks: 특수문자(&, ?, #)도 안전하게 인코딩", () => {
  const links = buildSnsDeeplinks("foo & bar?#x");
  assert.ok(!links.x_search!.includes("foo & bar"), "raw &, ? 가 그대로 들어가지 않음");
  assert.match(links.x_search!, /%26/, "& → %26");
  assert.match(links.x_search!, /%3F/, "? → %3F");
  assert.match(links.x_search!, /%23/, "# → %23");
});

test("buildSnsDeeplinks: 빈 문자열·공백·null/undefined → 모두 null", () => {
  for (const v of ["", "   ", "\t", null, undefined]) {
    const links = buildSnsDeeplinks(v);
    assert.equal(links.x_search, null);
    assert.equal(links.threads_search, null);
    assert.equal(links.youtube_search, null);
    assert.equal(links.github_search, null);
  }
});
