import test from "node:test";
import assert from "node:assert/strict";

import {
  parseClientMeta,
  parseErrorItems,
  parseEventItems,
  MAX_ERRORS_PER_BATCH,
  MAX_EVENTS_PER_BATCH,
  MAX_STACK_LENGTH,
} from "./client_reports";

test("parseClientMeta: 정상 페이로드를 정규화한다", () => {
  const meta = parseClientMeta({
    clientId: "a1b2c3d4-e5f6-7890",
    appVersion: "1.0.2",
    platform: "Android",
    osVersion: "14",
    deviceModel: "SM-S921N",
  });
  assert.ok(meta);
  assert.equal(meta.platform, "android");
  assert.equal(meta.appVersion, "1.0.2");
});

test("parseClientMeta: clientId 형식이 어긋나면 null", () => {
  assert.equal(parseClientMeta({ clientId: "short" }), null);
  assert.equal(parseClientMeta({ clientId: "bad id with spaces!" }), null);
  assert.equal(parseClientMeta({}), null);
  assert.equal(parseClientMeta(null), null);
  assert.equal(parseClientMeta("string"), null);
});

test("parseErrorItems: 배치 상한을 넘는 항목은 잘라낸다", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    fingerprint: `fp${i}`,
    message: `boom ${i}`,
  }));
  assert.equal(parseErrorItems(items).length, MAX_ERRORS_PER_BATCH);
});

test("parseErrorItems: message 없는 항목·잘못된 fingerprint는 버린다", () => {
  const items = parseErrorItems([
    { fingerprint: "ok1", message: "boom", stack: "at main", isFatal: true, count: 3.9 },
    { fingerprint: "no message" },
    { fingerprint: "bad fp!", message: "x" },
    { fingerprint: "ok2", message: "", stack: "" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].fingerprint, "ok1");
  assert.equal(items[0].count, 3);
  assert.equal(items[0].isFatal, true);
});

test("parseErrorItems: stack은 상한 길이로 잘린다", () => {
  const items = parseErrorItems([
    { fingerprint: "fp", message: "m", stack: "x".repeat(MAX_STACK_LENGTH * 2) },
  ]);
  assert.equal(items[0].stack.length, MAX_STACK_LENGTH);
});

test("parseEventItems: 이름 화이트리스트 검증 + 동일 이름 병합", () => {
  const items = parseEventItems([
    { name: "screen_home", count: 2 },
    { name: "screen_home", count: 3 },
    { name: "Bad-Name", count: 1 },
    { name: "app_open" },
  ]);
  const byName = new Map(items.map((item) => [item.name, item.count]));
  assert.equal(byName.get("screen_home"), 5);
  assert.equal(byName.get("app_open"), 1);
  assert.equal(byName.has("Bad-Name"), false);
});

test("parseEventItems: 배치 상한 초과분은 무시한다", () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ name: `event_${i}` }));
  assert.equal(parseEventItems(items).length, MAX_EVENTS_PER_BATCH);
});

test("parseEventItems: 배열이 아니면 빈 배열", () => {
  assert.deepEqual(parseEventItems(null), []);
  assert.deepEqual(parseEventItems({}), []);
});
