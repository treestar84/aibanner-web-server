import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("youtube recent route sanitizes query params before DB access", () => {
  assert.match(
    routeSource,
    /const limit = parseYouTubeRecentLimit\(url\.searchParams\.get\("limit"\)\);/,
    "route should clamp invalid public limit values before querying the DB",
  );
  assert.match(
    routeSource,
    /getRecentYoutubeVideos\(limit, filter\)/,
    "route should pass the sanitized limit and parsed type filter to the DB query",
  );
  assert.equal(
    routeSource.includes("parseInt("),
    false,
    "route should not parse public limit values inline",
  );
});
