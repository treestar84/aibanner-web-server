import test from "node:test";
import assert from "node:assert/strict";

import { getMinSupportedVersion, isValidSemver } from "./app_version";

test("getMinSupportedVersion: 환경변수 미설정 시 기본값 1.0.0을 반환한다", () => {
  const original = process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  delete process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  try {
    assert.equal(getMinSupportedVersion(), "1.0.0");
  } finally {
    if (original === undefined) {
      delete process.env.VIBENOW_MIN_SUPPORTED_VERSION;
    } else {
      process.env.VIBENOW_MIN_SUPPORTED_VERSION = original;
    }
  }
});

test("getMinSupportedVersion: 환경변수가 설정되면 해당 값을 반환한다", () => {
  const original = process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  process.env.VIBENOW_MIN_SUPPORTED_VERSION = "1.2.0";
  try {
    assert.equal(getMinSupportedVersion(), "1.2.0");
  } finally {
    if (original === undefined) {
      delete process.env.VIBENOW_MIN_SUPPORTED_VERSION;
    } else {
      process.env.VIBENOW_MIN_SUPPORTED_VERSION = original;
    }
  }
});

test("getMinSupportedVersion: 형식이 잘못된 값은 기본값으로 폴백한다 (세이프가드)", () => {
  const original = process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  process.env.VIBENOW_MIN_SUPPORTED_VERSION = "10.2";
  try {
    assert.equal(getMinSupportedVersion(), "1.0.0");
  } finally {
    if (original === undefined) {
      delete process.env.VIBENOW_MIN_SUPPORTED_VERSION;
    } else {
      process.env.VIBENOW_MIN_SUPPORTED_VERSION = original;
    }
  }
});

test("isValidSemver: x.y.z 형식만 허용한다", () => {
  assert.equal(isValidSemver("1.0.2"), true);
  assert.equal(isValidSemver(" 2.10.33 "), true);
  assert.equal(isValidSemver("1.0"), false);
  assert.equal(isValidSemver("1.0.2-beta"), false);
  assert.equal(isValidSemver("v1.0.2"), false);
  assert.equal(isValidSemver("999999.0.0"), false);
  assert.equal(isValidSemver(""), false);
});

test("getMinSupportedVersion: 공백 문자열은 기본값으로 대체한다", () => {
  const original = process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  process.env.VIBENOW_MIN_SUPPORTED_VERSION = "   ";
  try {
    assert.equal(getMinSupportedVersion(), "1.0.0");
  } finally {
    if (original === undefined) {
      delete process.env.VIBENOW_MIN_SUPPORTED_VERSION;
    } else {
      process.env.VIBENOW_MIN_SUPPORTED_VERSION = original;
    }
  }
});
