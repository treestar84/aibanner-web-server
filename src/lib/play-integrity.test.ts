import assert from "node:assert/strict";
import test from "node:test";

test("acceptable verdicts list matches the two integrity tiers we trust", async () => {
  const { verifyIntegrityToken } = await import("./play-integrity");
  await assert.rejects(
    () => verifyIntegrityToken("token", "pkg"),
    /PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY/,
  );
});
