import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("route requires a valid postToken via requirePostToken", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /auth instanceof NextResponse/);
});

test("device/me awards attendance points on every call, relying on points-ledger's daily cap for idempotency", () => {
  assert.match(routeSource, /awardPoints\(auth\.deviceId, "attendance"\)/);
});

test("response uses the post-award points total, not the stale value from requirePostToken", () => {
  assert.match(routeSource, /const \{ newTotal \} = await awardPoints/);
  assert.match(routeSource, /computeTier\(auth\.firstSeenAt, newTotal\)/);
  assert.match(routeSource, /pointsTotal: newTotal/);
  assert.doesNotMatch(routeSource, /computeTier\(auth\.firstSeenAt, auth\.pointsTotal\)/);
});

test("top tier (tier 5) reports no next threshold and zero points needed", () => {
  assert.match(routeSource, /TIER_POINT_THRESHOLDS\[tier\] \?\? null/);
  assert.match(routeSource, /pointsToNextTier: nextThreshold !== null \? Math\.max\(0, nextThreshold - newTotal\) : 0/);
});

test("the whole handler is wrapped in this repo's standard outer try/catch, converting rethrown errors to a 500 JSON response", () => {
  assert.match(routeSource, /export async function GET\(req: NextRequest\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /\} catch \(err\) \{\s*\n\s*const message = err instanceof Error \? err\.message : "Internal server error";/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});
