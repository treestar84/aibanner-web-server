import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./play-integrity.ts", import.meta.url), "utf8");

test("an unset service account key rejects instead of silently passing the device", async () => {
  const { verifyIntegrityToken } = await import("./play-integrity");
  const previous = process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY;
  delete process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY;
  try {
    await assert.rejects(
      () => verifyIntegrityToken("token", "pkg"),
      /PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY is not configured/,
    );
  } finally {
    if (previous !== undefined) process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY = previous;
  }
});

test("a bare bearer-style string is rejected as a malformed service account key", async () => {
  const { parseServiceAccountKey } = await import("./play-integrity");
  assert.throws(
    () => parseServiceAccountKey("ya29.some-raw-token"),
    /must contain the service account JSON key/,
  );
});

test("valid JSON that is not a service account key is rejected", async () => {
  const { parseServiceAccountKey } = await import("./play-integrity");
  assert.throws(
    () => parseServiceAccountKey('{"type":"service_account"}'),
    /missing client_email or private_key/,
  );
  assert.throws(
    () => parseServiceAccountKey('{"client_email":"a@b.iam.gserviceaccount.com"}'),
    /missing client_email or private_key/,
  );
});

test("a well-formed service account key parses into email + private key", async () => {
  const { parseServiceAccountKey } = await import("./play-integrity");
  const parsed = parseServiceAccountKey(
    JSON.stringify({
      type: "service_account",
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
    }),
  );
  assert.equal(parsed.client_email, "svc@example.iam.gserviceaccount.com");
  assert.match(parsed.private_key, /BEGIN PRIVATE KEY/);
});

test("the API call uses a minted OAuth2 access token, never the raw env var", () => {
  // 이 회귀가 원래 결함이었다: 서비스 계정 키 원문을 Bearer로 그대로 보내면
  // playintegrity.googleapis.com이 전부 401/403으로 거절한다.
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(source, /Bearer \$\{apiKey\}/);
  assert.doesNotMatch(
    source,
    /Bearer \$\{process\.env\.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY\}/,
  );
});

test("the token is scoped to the Play Integrity OAuth2 scope via google-auth-library", () => {
  assert.match(source, /from "google-auth-library"/);
  assert.match(source, /https:\/\/www\.googleapis\.com\/auth\/playintegrity/);
  assert.match(source, /scopes: \[PLAY_INTEGRITY_SCOPE\]/);
});

test("acceptable verdicts stay limited to the two integrity tiers we trust", () => {
  assert.match(
    source,
    /ACCEPTABLE_VERDICTS = \["MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"\]/,
  );
});
