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
});

test("top endpoint falls back to author_label when a post has no linked device", () => {
  assert.match(routeSource, /COALESCE\(dp\.nickname, ep\.author_label\) AS author_nickname/);
});

test("top endpoint exposes a hashed author_key instead of the raw device id", () => {
  assert.match(routeSource, /import \{ authorKeyFor \} from "@\/lib\/author-key"/);
  assert.match(routeSource, /dp\.device_id AS author_device_id/);
  assert.match(routeSource, /author_key: authorKeyFor\(author_device_id as string \| null\)/);
});

test("top endpoint caps limit at 10 and revalidates every 60s", () => {
  assert.match(routeSource, /Math\.min\(Number\.parseInt\(req\.nextUrl\.searchParams\.get\("limit"\) \?\? "10", 10\) \|\| 10, 10\)/);
  assert.match(routeSource, /export const revalidate = 60;/);
});

// I7: 이 라우트도 저장소 표준 바깥쪽 try/catch가 없어 DB 오류가 그대로
// 프레임워크 기본 예외로 새어 나갔다.
test("the handler is wrapped in the repo's standard outer try/catch", () => {
  assert.match(routeSource, /export async function GET\(req: NextRequest\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /console\.error\("\[\/api\/v1\/posts\/top\]\[GET\]", err\)/);
  assert.match(routeSource, /return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/);
});
