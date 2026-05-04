import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTavilyFailure,
  resolveTavilyApiKeys,
} from "@/lib/pipeline/tavily";

test("resolveTavilyApiKeys preserves primary key order and de-duplicates fallback keys", () => {
  assert.deepEqual(
    resolveTavilyApiKeys({
      TAVILY_API_KEY: "primary",
      TAVILY_API_KEYS: "fallback-a, fallback-b\nprimary,, fallback-a",
    }),
    ["primary", "fallback-a", "fallback-b"]
  );
});

test("resolveTavilyApiKeys supports only the legacy single-key env", () => {
  assert.deepEqual(
    resolveTavilyApiKeys({
      TAVILY_API_KEY: "legacy-key",
      TAVILY_API_KEYS: undefined,
    }),
    ["legacy-key"]
  );
});

test("classifyTavilyFailure detects quota and rate-limit failures", () => {
  assert.equal(
    classifyTavilyFailure(new Error("Monthly API credits quota exceeded")),
    "quota"
  );
  assert.equal(
    classifyTavilyFailure({ status: 429, message: "Too many requests" }),
    "rate_limit"
  );
  assert.equal(
    classifyTavilyFailure({ statusCode: "429", message: "slow down" }),
    "rate_limit"
  );
  assert.equal(classifyTavilyFailure(new Error("socket hang up")), "other");
});
