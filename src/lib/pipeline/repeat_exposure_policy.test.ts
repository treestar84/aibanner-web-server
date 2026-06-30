import assert from "node:assert/strict";
import test from "node:test";

import { calculateRepeatExposureDelta } from "@/lib/pipeline/repeat_exposure_policy";

test("calculateRepeatExposureDelta keeps 2 to 3 day breakout eligible", () => {
  const delta = calculateRepeatExposureDelta({
    appearances: 9,
    score_velocity: 0.52,
    score_engagement: 0.48,
    score_authority: 0.72,
    freshnessReasons: ["recent_source", "breakout_velocity"],
    isBroadGeneric: false,
    hasRelevantSource: true,
  });

  assert.equal(delta >= 0, true);
});

test("calculateRepeatExposureDelta demotes 3 day stale evergreen", () => {
  const delta = calculateRepeatExposureDelta({
    appearances: 12,
    score_velocity: 0.02,
    score_engagement: 0.05,
    score_authority: 0.3,
    freshnessReasons: ["stale_no_evidence"],
    isBroadGeneric: false,
    hasRelevantSource: false,
  });

  assert.equal(delta <= -0.1, true);
});

test("calculateRepeatExposureDelta softens 3 day reignition without boosting", () => {
  const delta = calculateRepeatExposureDelta({
    appearances: 13,
    score_velocity: 0.5,
    score_engagement: 0.44,
    score_authority: 0.72,
    freshnessReasons: ["recent_source", "reignition"],
    isBroadGeneric: false,
    hasRelevantSource: true,
  });

  assert.equal(delta <= 0, true);
  assert.equal(delta > -0.1, true);
});

test("calculateRepeatExposureDelta requires broad generic reignition and relevant source", () => {
  const weakGeneric = calculateRepeatExposureDelta({
    appearances: 13,
    score_velocity: 0.5,
    score_engagement: 0.44,
    score_authority: 0.72,
    freshnessReasons: ["recent_source", "reignition"],
    isBroadGeneric: true,
    hasRelevantSource: false,
  });
  const supportedGeneric = calculateRepeatExposureDelta({
    appearances: 13,
    score_velocity: 0.5,
    score_engagement: 0.44,
    score_authority: 0.72,
    freshnessReasons: ["recent_source", "reignition"],
    isBroadGeneric: true,
    hasRelevantSource: true,
  });

  assert.equal(weakGeneric <= -0.1, true);
  assert.equal(supportedGeneric > weakGeneric, true);
  assert.equal(supportedGeneric <= 0, true);
});
