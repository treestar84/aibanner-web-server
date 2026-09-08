import assert from "node:assert/strict";
import test from "node:test";

import { classifyFeedHealth } from "./source-health";

const base = {
  totalItems: 10,
  datedItems: 10,
  missingDateItems: 0,
  invalidDateItems: 0,
  latestAgeHours: 12,
  recentItems: 2,
  staleHours: 336,
};

test("classifies a reachable feed with recent dated items as healthy", () => {
  assert.deepEqual(classifyFeedHealth(base), {
    status: "healthy",
    severity: "ok",
    reasons: [],
  });
});

test("distinguishes a healthy low-frequency feed from a stale feed", () => {
  assert.equal(
    classifyFeedHealth({ ...base, latestAgeHours: 120, recentItems: 0 }).status,
    "no_recent"
  );
  assert.equal(
    classifyFeedHealth({ ...base, latestAgeHours: 400, recentItems: 0 }).status,
    "stale"
  );
});

test("reports empty and undated feeds as warnings", () => {
  assert.equal(
    classifyFeedHealth({ ...base, totalItems: 0, datedItems: 0, recentItems: 0 }).status,
    "empty"
  );
  assert.equal(
    classifyFeedHealth({ ...base, datedItems: 0, missingDateItems: 10 }).status,
    "undated"
  );
});
