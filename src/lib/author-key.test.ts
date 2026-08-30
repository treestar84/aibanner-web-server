import assert from "node:assert/strict";
import test from "node:test";
import { authorKeyFor } from "./author-key";

test("authorKeyFor returns a stable, deterministic key for the same device id", () => {
  const a = authorKeyFor("device-abc-123");
  const b = authorKeyFor("device-abc-123");
  assert.equal(a, b);
});

test("authorKeyFor returns different keys for different device ids", () => {
  assert.notEqual(authorKeyFor("device-a"), authorKeyFor("device-b"));
});

test("authorKeyFor never returns the raw device id", () => {
  const deviceId = "device-abc-123";
  assert.notEqual(authorKeyFor(deviceId), deviceId);
  assert.ok(!authorKeyFor(deviceId)!.includes(deviceId));
});

test("authorKeyFor returns null for null/undefined (editor picks have no author device)", () => {
  assert.equal(authorKeyFor(null), null);
  assert.equal(authorKeyFor(undefined), null);
});
