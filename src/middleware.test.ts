import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middlewareSource = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");

test("expert-picks views endpoint has its own tighter rate limit than the general list endpoint", () => {
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks\/views",\s*\d+\]/);
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks",\s*\d+\]/);
});

test("content-likes toggle endpoint is rate-limited tighter than its batch counts read", () => {
  const countsMatch = middlewareSource.match(
    /\["\/api\/v1\/content-likes\/counts",\s*(\d+)\]/,
  );
  const toggleMatch = middlewareSource.match(
    /\["\/api\/v1\/content-likes",\s*(\d+)\]/,
  );
  assert.ok(countsMatch, "content-likes/counts rate limit entry not found");
  assert.ok(toggleMatch, "content-likes rate limit entry not found");
  const countsRpm = Number(countsMatch![1]);
  const toggleRpm = Number(toggleMatch![1]);
  assert.ok(
    toggleRpm < countsRpm,
    "a single-tap toggle endpoint should be capped tighter than a batch read",
  );

  // 더 구체적인 prefix(counts)가 배열에서 더 앞에 있어야 한다 — 뒤에 있으면
  // startsWith 매칭에서 "/api/v1/content-likes"에 먼저 걸려 counts 전용
  // 제한이 절대 적용되지 않는다.
  const countsIndex = middlewareSource.indexOf('"/api/v1/content-likes/counts"');
  const toggleIndex = middlewareSource.indexOf('"/api/v1/content-likes"');
  assert.ok(countsIndex >= 0 && toggleIndex >= 0);
  assert.ok(countsIndex < toggleIndex);
});

test("device register endpoint is rate-limited tighter than posts endpoints", () => {
  const deviceMatch = middlewareSource.match(
    /\["\/api\/v1\/device\/register",\s*(\d+)\]/,
  );
  const postsMatch = middlewareSource.match(
    /\["\/api\/v1\/posts",\s*(\d+)\]/,
  );
  assert.ok(deviceMatch, "device/register rate limit entry not found");
  assert.ok(postsMatch, "posts rate limit entry not found");
  const deviceRpm = Number(deviceMatch![1]);
  const postsRpm = Number(postsMatch![1]);
  assert.ok(
    deviceRpm < postsRpm,
    "registration endpoint should be capped much tighter than general posts endpoint",
  );
});

test("posts top endpoint comes before posts general endpoint in RATE_LIMITS array", () => {
  // 더 구체적인 prefix(posts/top)가 배열에서 더 앞에 있어야 한다 — 뒤에 있으면
  // startsWith 매칭에서 "/api/v1/posts"에 먼저 걸려 posts/top 전용
  // 제한이 절대 적용되지 않는다.
  const topIndex = middlewareSource.indexOf('"/api/v1/posts/top"');
  const postsIndex = middlewareSource.indexOf('"/api/v1/posts"');
  assert.ok(topIndex >= 0 && postsIndex >= 0);
  assert.ok(topIndex < postsIndex, "posts/top must appear before posts in the array");
});

test("posts upload-image endpoint is rate-limited tighter than general posts endpoint and comes first in RATE_LIMITS array", () => {
  const uploadMatch = middlewareSource.match(
    /\["\/api\/v1\/posts\/upload-image",\s*(\d+)\]/,
  );
  const postsMatch = middlewareSource.match(
    /\["\/api\/v1\/posts",\s*(\d+)\]/,
  );
  assert.ok(uploadMatch, "posts/upload-image rate limit entry not found");
  assert.ok(postsMatch, "posts rate limit entry not found");
  const uploadRpm = Number(uploadMatch![1]);
  const postsRpm = Number(postsMatch![1]);
  assert.ok(
    uploadRpm < postsRpm,
    "image upload endpoint should be capped tighter than general posts endpoint",
  );

  // 더 구체적인 prefix(posts/upload-image)가 배열에서 더 앞에 있어야 한다 — 뒤에 있으면
  // startsWith 매칭에서 "/api/v1/posts"에 먼저 걸려 upload-image 전용
  // 제한이 절대 적용되지 않는다.
  const uploadIndex = middlewareSource.indexOf('"/api/v1/posts/upload-image"');
  const postsIndex = middlewareSource.indexOf('"/api/v1/posts"');
  assert.ok(uploadIndex >= 0 && postsIndex >= 0);
  assert.ok(uploadIndex < postsIndex, "posts/upload-image must appear before posts in the array");
});

test("device/me has its own rate limit and is not left on the catch-all 100rpm bucket", () => {
  const meMatch = middlewareSource.match(/\["\/api\/v1\/device\/me",\s*(\d+)\]/);
  assert.ok(meMatch, "device/me rate limit entry not found");
  const meRpm = Number(meMatch![1]);
  assert.ok(meRpm > 0 && meRpm < 100, "device/me must be tighter than the /api/v1/ catch-all");

  // 프로필 조회는 등록보다 자주 일어나므로 register보다는 느슨해야 한다.
  const registerRpm = Number(
    middlewareSource.match(/\["\/api\/v1\/device\/register",\s*(\d+)\]/)![1],
  );
  assert.ok(meRpm > registerRpm);

  // /api/v1/device/* 전용 항목들이 catch-all "/api/v1/" 보다 앞에 있어야
  // startsWith 매칭에서 실제로 적용된다.
  const meIndex = middlewareSource.indexOf('"/api/v1/device/me"');
  const catchAllIndex = middlewareSource.indexOf('"/api/v1/"');
  assert.ok(meIndex >= 0 && catchAllIndex >= 0);
  assert.ok(meIndex < catchAllIndex, "device/me must appear before the /api/v1/ catch-all");
});
