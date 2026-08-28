import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("top endpoint requires an explicit scope and never mixes author types in one query", () => {
  assert.match(routeSource, /scope !== "user" && scope !== "editor"/);
  assert.match(routeSource, /ep\.author_type = \$\{scope\}/);
});

test("top endpoint ranks purely by like_count, no manual ORDER BY overrides", () => {
  assert.match(routeSource, /ORDER BY like_count DESC/);
});

test("top endpoint left-joins device_principals so editor rows (no author_device_id) still appear", () => {
  assert.match(routeSource, /LEFT JOIN device_principals dp ON dp\.device_id = ep\.author_device_id/);
  assert.match(routeSource, /dp\.nickname AS author_nickname/);
});

test("top endpoint caps limit at 10 and revalidates every 60s", () => {
  assert.match(routeSource, /Math\.min\(Number\.parseInt\(req\.nextUrl\.searchParams\.get\("limit"\) \?\? "10", 10\) \|\| 10, 10\)/);
  assert.match(routeSource, /export const revalidate = 60;/);
});
