import assert from "node:assert/strict";
import test from "node:test";
import {
  getViewerHash,
  isValidLikeContentType,
  LIKE_CONTENT_TYPES,
} from "./content-like-tracking";

test("isValidLikeContentType accepts exactly the 4 content types the app has", () => {
  for (const type of ["trends", "burning", "hotTopics", "expertPicks"]) {
    assert.equal(isValidLikeContentType(type), true, `${type} should be valid`);
  }
  assert.equal(isValidLikeContentType("keywords"), false);
  assert.equal(isValidLikeContentType(""), false);
  assert.equal(isValidLikeContentType("Trends"), false, "must be case-sensitive to match Dart's enum.name");
});

test("LIKE_CONTENT_TYPES matches Flutter's LikedContentSection.name values exactly", () => {
  assert.deepEqual([...LIKE_CONTENT_TYPES], ["trends", "burning", "hotTopics", "expertPicks"]);
});

test("getViewerHash returns null when VIEW_EVENT_HMAC_SECRET is unconfigured", () => {
  const original = process.env.VIEW_EVENT_HMAC_SECRET;
  delete process.env.VIEW_EVENT_HMAC_SECRET;
  try {
    const req = new Request("https://example.test/api/v1/content-likes", {
      headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "test-agent" },
    });
    assert.equal(getViewerHash(req), null);
  } finally {
    if (original !== undefined) process.env.VIEW_EVENT_HMAC_SECRET = original;
  }
});

test("getViewerHash is deterministic for the same IP+UA and differs across IPs", () => {
  const original = process.env.VIEW_EVENT_HMAC_SECRET;
  process.env.VIEW_EVENT_HMAC_SECRET = "test-secret";
  try {
    const reqA1 = new Request("https://example.test/x", {
      headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "ua" },
    });
    const reqA2 = new Request("https://example.test/x", {
      headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "ua" },
    });
    const reqB = new Request("https://example.test/x", {
      headers: { "x-forwarded-for": "5.6.7.8", "user-agent": "ua" },
    });

    const hashA1 = getViewerHash(reqA1);
    const hashA2 = getViewerHash(reqA2);
    const hashB = getViewerHash(reqB);

    assert.ok(hashA1);
    assert.equal(hashA1, hashA2);
    assert.notEqual(hashA1, hashB);
  } finally {
    if (original !== undefined) {
      process.env.VIEW_EVENT_HMAC_SECRET = original;
    } else {
      delete process.env.VIEW_EVENT_HMAC_SECRET;
    }
  }
});
