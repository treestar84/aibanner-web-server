import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExpertPickIds } from "./expert-pick-view-tracking";

test("normalizeExpertPickIds keeps only positive integers, dedupes, caps at 20", () => {
  const input = [1, 1, 2, "3", -1, 0, 4.5, "not a number", ...Array.from({ length: 30 }, (_, i) => i + 100)];
  const result = normalizeExpertPickIds(input);
  assert.deepEqual(result.slice(0, 3), [1, 2, 100]);
  assert.ok(result.length <= 20);
  assert.ok(result.every((id) => Number.isInteger(id) && id > 0));
});
