import test from "node:test";
import assert from "node:assert/strict";

import { getMinSupportedVersion } from "./app_version";

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
