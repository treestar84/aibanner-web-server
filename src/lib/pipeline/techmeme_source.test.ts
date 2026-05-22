import test from "node:test";
import assert from "node:assert/strict";

import { __private__ } from "./techmeme_source";

test("Techmeme Big Tech filter accepts major technology company mentions", () => {
  assert.equal(
    __private__.isBigTechItem("Microsoft announces new AI datacenter plan", ""),
    true
  );
  assert.equal(
    __private__.isBigTechItem("Startup launches a calendar app", "No major platform company mentioned"),
    false
  );
});
