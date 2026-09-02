import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("top endpoint requires an explicit scope of user, editor, or all", () => {
  assert.match(routeSource, /scope !== "user" && scope !== "editor" && scope !== "all"/);
});

// scope='all'은 위젯의 "커뮤니티" 슬롯처럼 에디터픽/사용자 글을 좋아요 수
// 하나의 순위로 섞어야 하는 곳에서 쓴다 — author_type 필터를 건너뛴다.
test("scope='all' bypasses the author_type filter to rank editor and user posts together", () => {
  assert.match(routeSource, /\$\{scope\}::text = 'all' OR ep\.author_type = \$\{scope\}::text/);
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

test("top endpoint computes is_admin_authored from device presence, without leaking the raw device id", () => {
  assert.match(routeSource, /\(dp\.device_id IS NULL\) AS is_admin_authored/);
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
