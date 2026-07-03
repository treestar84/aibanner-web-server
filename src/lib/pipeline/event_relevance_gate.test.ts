import assert from "node:assert/strict";
import test from "node:test";

import { selectByEventRelevance } from "@/lib/pipeline/event_relevance_gate";

test("selectByEventRelevance drops candidates scoring below the threshold", () => {
  const candidates = ["a", "b", "c"];
  const scores = { "0": 8, "1": 3, "2": 5 };

  const selected = selectByEventRelevance(candidates, scores, 5);

  assert.deepEqual(selected, ["a", "c"]);
});

test("selectByEventRelevance passes candidates with missing scores (fail-open)", () => {
  const candidates = ["a", "b", "c"];
  const scores = { "0": 8 };

  const selected = selectByEventRelevance(candidates, scores, 5);

  assert.deepEqual(selected, ["a", "b", "c"]);
});

test("selectByEventRelevance passes candidates with non-numeric scores (fail-open)", () => {
  const candidates = ["a", "b", "c"];
  const scores = { "0": "high", "1": Number.NaN, "2": 2 } as unknown as Record<string, number>;

  const selected = selectByEventRelevance(candidates, scores, 5);

  assert.deepEqual(selected, ["a", "b"]);
});

test("selectByEventRelevance handles an empty candidate list", () => {
  const selected = selectByEventRelevance([], {}, 5);
  assert.deepEqual(selected, []);
});
