import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultScheduleUtcForMode,
  parseScheduleUtc,
  scheduleKstForMode,
  scheduleUtcToKstStrings,
} from "./schedule";

describe("pipeline schedule", () => {
  it("keeps the default realtime schedule aligned with app-visible KST slots", () => {
    assert.equal(defaultScheduleUtcForMode("realtime"), "0:10,2:10,4:10,6:10");
    assert.deepEqual(scheduleKstForMode("realtime"), [
      "09:10",
      "11:10",
      "13:10",
      "15:10",
    ]);
  });

  it("deduplicates and sorts parsed UTC slots before converting to KST", () => {
    const slots = parseScheduleUtc("6:10,0:10,6:10,2:10", "0:10");

    assert.deepEqual(scheduleUtcToKstStrings(slots), [
      "09:10",
      "11:10",
      "15:10",
    ]);
  });
});
