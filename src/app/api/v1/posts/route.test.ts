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
  assert.match(routeSource, /VALUES \(NULL,/);
});

test("posts are authenticated via requirePostToken before any DB write", () => {
  assert.match(routeSource, /requirePostToken\(req\)/);
  assert.match(routeSource, /auth instanceof NextResponse/);
});

test("cooldown-free tiers (3-5) re-check today's post count against perDay before insert, since canPostNow only compares timestamps", () => {
  assert.match(routeSource, /freq\.cooldownDays === 0 && freq\.perDay > 0/);
  assert.match(routeSource, /SELECT COUNT\(\*\)::int AS cnt FROM expert_picks/);
  assert.match(routeSource, /todayCount >= freq\.perDay/);
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
  assert.match(routeSource, /cursorId = cursor \? Number\.parseInt\(cursor, 10\) : null/);
  assert.match(routeSource, /ep\.id < \$\{cursorId\}::int/);
  assert.match(routeSource, /ORDER BY ep\.id DESC/);
});

// I5: 업로드 라우트의 MIME/용량/인증 검사를 우회하는 임의 imageUrl 차단
test("POST validates imageUrl against the blob host instead of trusting the client", () => {
  assert.match(routeSource, /import \{ isAllowedBlobImageUrl \} from "@\/lib\/blob-image-url"/);
  assert.match(routeSource, /if \(imageUrl && !isAllowedBlobImageUrl\(imageUrl\)\)/);
  assert.match(routeSource, /status: 400/);
  // 검증하지 않은 원본 값이 INSERT로 새어 들어가면 안 된다.
  assert.doesNotMatch(routeSource, /body\?\.imageUrl \?\? ""/);
});
