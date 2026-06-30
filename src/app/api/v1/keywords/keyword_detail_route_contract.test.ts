import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const routeSource = readFileSync(
  new URL("./[id]/route.ts", import.meta.url),
  "utf8",
);

test("keyword detail route always looks up the keyword in the resolved snapshot", () => {
  assert.equal(
    routeSource.includes("getKeywordInLatestSnapshot"),
    false,
    "route must not fall back to an older summarized keyword row",
  );
  assert.match(
    routeSource,
    /const keyword = await getKeywordById\(id, snapshotId\);/,
    "route should use the explicit or latest resolved snapshotId for keyword lookup",
  );
});
