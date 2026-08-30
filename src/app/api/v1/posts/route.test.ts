import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("posts endpoint gates on tier-based posting frequency before accepting a body", () => {
  assert.match(routeSource, /canPostNow\(tier, lastPostAt\)/);
  assert.match(routeSource, /status: 429/);
});

test("posts endpoint caps body length to prevent long-form abuse of a title-less format", () => {
  assert.match(routeSource, /bodyKo\.length > 1000/);
});

test("user posts are stored with author_type='user' and the author's device id, never a title", () => {
  assert.match(routeSource, /'user', \$\{deviceId\}/);
  // 삽입 행의 첫 컬럼(title_ko)은 항상 NULL이다 — 사용자 글은 제목이 없다.
  assert.match(routeSource, /SELECT\s*\n\s*NULL, \$\{bodyKo\}, \$\{bodyKo\}, 'user'/);
});

test("posts are authenticated via requirePostToken before any DB write", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /auth instanceof NextResponse/);
});

// I6: 게시 빈도 게이트도 check-then-insert였다. canPostNow는 시각 비교만 하고
// 오늘자 개수는 보지 않으므로, 상한 재확인이 반드시 삽입과 같은 문장에서
// 일어나야 한다(별도 왕복이면 동시 요청 둘 다 통과한다).
test("the perDay count and the cooldown are re-checked inside the same statement as the insert", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  const sqlCalls = postFn.match(/await sql`/g) ?? [];
  assert.equal(
    sqlCalls.length,
    1,
    "a separate COUNT round-trip before the insert reopens the race",
  );
  assert.match(postFn, /WITH gate AS \(/);
  assert.match(postFn, /SELECT COUNT\(\*\)::int FROM expert_picks/);
  assert.match(postFn, /WHERE g\.today_count < \$\{freq\.perDay\}::int/);
  assert.match(postFn, /g\.last_post_at <= NOW\(\) - \(\$\{freq\.cooldownDays\}::int \* INTERVAL '1 day'\)/);
});

test("last_post_at is only bumped when the gated insert actually happened", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(
    postFn,
    /UPDATE device_principals SET last_post_at = NOW\(\)\s*\n\s*WHERE device_id = \$\{deviceId\} AND EXISTS \(SELECT 1 FROM ins\)/,
  );
});

test("a gated-out insert returns 429 rather than reporting a successful post", () => {
  assert.match(routeSource, /if \(insertedId === null\)/);
  assert.match(routeSource, /Daily post limit reached for your tier/);
});

test("canPostNow still runs first so the friendly nextAllowedAt response is preserved", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  const gateIndex = postFn.indexOf("canPostNow(tier, lastPostAt)");
  const sqlIndex = postFn.indexOf("await sql`");
  assert.ok(gateIndex > 0 && sqlIndex > 0 && gateIndex < sqlIndex);
  assert.match(postFn, /nextAllowedAt: gate\.nextAllowedAt \?\? null/);
});

test("feed GET only returns visible user posts, never editor picks or hidden/removed posts", () => {
  assert.match(routeSource, /export async function GET\(req: NextRequest\)/);
  assert.match(routeSource, /ep\.author_type = 'user' AND ep\.status = 'visible'/);
});

test("feed GET joins device_principals for a live nickname instead of reading a stored column", () => {
  assert.match(routeSource, /JOIN device_principals dp ON dp\.device_id = ep\.author_device_id/);
  assert.match(routeSource, /dp\.nickname AS author_nickname/);
});

test("feed GET paginates by cursor on descending id", () => {
  assert.match(routeSource, /ep\.id < \$\{cursorId\}::int/);
  assert.match(routeSource, /ORDER BY ep\.id DESC/);
});

test("feed GET exposes a hashed author_key instead of the raw device id", () => {
  assert.match(routeSource, /import \{ authorKeyFor \} from "@\/lib\/author-key"/);
  assert.match(routeSource, /dp\.device_id AS author_device_id/);
  assert.match(routeSource, /author_key: authorKeyFor\(author_device_id as string \| null\)/);
  // author_device_id는 응답 items에 그대로 남아있으면 안 된다 — map에서 걷어낸다.
  assert.match(routeSource, /const items = rows\.map\(\(\{ author_device_id, \.\.\.rest \}\)/);
  assert.match(routeSource, /NextResponse\.json\(\{ items \}\);/);
});

// I7: 두 핸들러 모두 이 저장소 표준인 바깥쪽 try/catch가 없었다.
test("both handlers are wrapped in the repo's standard outer try/catch", () => {
  assert.match(routeSource, /export async function POST\(req: NextRequest\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /export async function GET\(req: NextRequest\) \{\s*\n\s*try \{/);
  assert.match(routeSource, /console\.error\("\[\/api\/v1\/posts\]\[POST\]", err\)/);
  assert.match(routeSource, /console\.error\("\[\/api\/v1\/posts\]\[GET\]", err\)/);
  const handlers = routeSource.match(/return NextResponse\.json\(\{ error: message \}, \{ status: 500 \}\);/g) ?? [];
  assert.equal(handlers.length, 2, "each handler needs its own 500 fallback");
});

// ?cursor=abc는 NaN이 되어 그대로 쿼리로 나갔다. try/catch로 덮지 말고
// 명시적으로 400을 돌려준다.
test("a non-numeric cursor is rejected with 400, not passed to the DB as NaN", () => {
  assert.match(routeSource, /const parsed = Number\.parseInt\(cursor, 10\);/);
  assert.match(routeSource, /if \(!Number\.isFinite\(parsed\)\) \{/);
  assert.match(routeSource, /cursor must be an integer/);
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  const validationIndex = getFn.indexOf("Number.isFinite(parsed)");
  const queryIndex = getFn.indexOf("await sql`");
  assert.ok(validationIndex > 0 && queryIndex > 0);
  assert.ok(validationIndex < queryIndex, "cursor must be validated before the query runs");
});

test("an absent cursor still means 'first page', not a 400", () => {
  assert.match(routeSource, /if \(cursor !== null && cursor !== ""\)/);
  assert.match(routeSource, /let cursorId: number \| null = null;/);
});

// I5: 업로드 라우트의 MIME/용량/인증 검사를 우회하는 임의 imageUrl 차단
test("POST validates imageUrl against the blob host instead of trusting the client", () => {
  assert.match(routeSource, /import \{ isAllowedBlobImageUrl \} from "@\/lib\/blob-image-url"/);
  assert.match(routeSource, /if \(imageUrl && !isAllowedBlobImageUrl\(imageUrl\)\)/);
  assert.match(routeSource, /status: 400/);
  // 검증하지 않은 원본 값이 INSERT로 새어 들어가면 안 된다.
  assert.doesNotMatch(routeSource, /body\?\.imageUrl \?\? ""/);
});
