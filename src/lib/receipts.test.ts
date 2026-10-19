import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  communityPostIdFromKey,
  generateReceiptCode,
  maskReceiptItems,
  normalizeContentKeys,
  isLinkPreviewBot,
  isValidReceiptCode,
  kstDayBucket,
  normalizeContentKey,
  normalizeShareChannel,
  receiptVisitorHash,
} from "./receipts-policy";

const librarySource = readFileSync(new URL("./receipts.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8");
const pageSource = readFileSync(
  new URL("../app/r/[code]/page.tsx", import.meta.url),
  "utf8",
);
const middlewareSource = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const receiptsRouteSource = readFileSync(
  new URL("../app/api/v1/receipts/route.ts", import.meta.url),
  "utf8",
);
const sharesRouteSource = readFileSync(
  new URL("../app/api/v1/flying/shares/route.ts", import.meta.url),
  "utf8",
);

test("receipt codes are 8 characters from the unambiguous alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateReceiptCode();
    assert.equal(code.length, 8);
    assert.ok(isValidReceiptCode(code), code);
  }
  assert.equal(isValidReceiptCode("abc"), false);
  assert.equal(isValidReceiptCode("abcdefg0"), false); // 0은 혼동 문자라 제외
  assert.equal(isValidReceiptCode("'; DROP"), false);
});

test("link preview crawlers never count as receipt opens", () => {
  for (const ua of [
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (compatible; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "TelegramBot (like TwitterBot)",
    "Discordbot/2.0",
    "WhatsApp/2.23",
    "curl/8.0",
    "",
  ]) {
    assert.equal(isLinkPreviewBot(ua), true, ua);
  }
  assert.equal(
    isLinkPreviewBot(
      "Mozilla/5.0 (Linux; Android 16; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    ),
    false,
  );
  // 카톡·라인·텔레그램·다음 인앱 브라우저로 사람이 연 경우는 센다.
  for (const ua of [
    "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 Line/14.1.0",
    "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 DaumApps/5.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Telegram-Android/11",
  ]) {
    assert.equal(isLinkPreviewBot(ua), false, ua);
  }
  assert.equal(
    isLinkPreviewBot(
      "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KAKAOTALK/11.0.0",
    ),
    false,
  );
});

test("visitor hash is per IP (UA changes do not mint new opens) and disabled without a secret", () => {
  const a = receiptVisitorHash("1.2.3.4", "secret");
  assert.equal(a, receiptVisitorHash("1.2.3.4", "secret"));
  assert.notEqual(a, receiptVisitorHash("1.2.3.5", "secret"));
  assert.equal(receiptVisitorHash("1.2.3.4", ""), null);
  assert.equal(receiptVisitorHash("1.2.3.4", undefined), null);
});

test("share channel and content key are normalized", () => {
  assert.equal(normalizeShareChannel("KAKAO"), "kakao");
  assert.equal(normalizeShareChannel("instagram"), "system");
  assert.equal(normalizeShareChannel(42), "system");
  assert.equal(normalizeContentKey("  trend:abc  "), "trend:abc");
  assert.equal(normalizeContentKey(""), null);
  assert.equal(normalizeContentKey("x".repeat(201)), null);
});

test("KST day bucket rolls over at KST midnight", () => {
  assert.equal(kstDayBucket(new Date("2026-10-19T14:59:59Z")), "2026-10-19");
  assert.equal(kstDayBucket(new Date("2026-10-19T15:00:00Z")), "2026-10-20");
});

test("flying shares are deduped per content per day and capped per day", () => {
  assert.match(schemaSource, /PRIMARY KEY \(device_id, content_key, day_bucket\)/);
  assert.match(librarySource, /WHERE t\.count < \$\{FLYING_SHARE_DAILY_CAP\}::int/);
  assert.match(librarySource, /ON CONFLICT DO NOTHING/);
});

test("receipt opens are deduped per visitor and only counted for humans", () => {
  assert.match(schemaSource, /PRIMARY KEY \(receipt_id, visitor_hash\)/);
  assert.match(pageSource, /if \(!isLinkPreviewBot\(userAgent\)\)/);
  assert.match(pageSource, /export const dynamic = "force-dynamic"/);
  assert.match(pageSource, /index: false/);
  assert.match(middlewareSource, /"\/r\/:path\*"/);
});

test("receipt and share endpoints require a device token", () => {
  for (const source of [receiptsRouteSource, sharesRouteSource]) {
    assert.match(source, /requirePostToken\(req\)/);
    assert.match(source, /auth instanceof NextResponse/);
  }
  assert.match(receiptsRouteSource, /RECEIPT_BODY_MAX_CHARS/);
  assert.match(receiptsRouteSource, /itemCount > RECEIPT_MAX_ITEMS/);
});

const SAMPLE_BODY = [
  "🧾 트렌드 영수증",
  "━━━━━━━━━━━━━━━━",
  "No.0007 · 2026.10.20 (화) 13:24",
  "발행인 @tree · ✈ 12 flying",
  "━━━━━━━━━━━━━━━━",
  "01 키워드 A",
  "   요약 A",
  "   🔗 https://example.com/k/a",
  "",
  "02 커뮤니티 글 제목",
  "   본문 일부",
  "",
  "03 핫토픽 C",
  "   요약 C",
  "   출처 연합뉴스 🔗 https://example.com/c",
  "━━━━━━━━━━━━━━━━",
  "합계 3건",
].join("\n");

test("removed community items are masked on the public receipt, others untouched", () => {
  const masked = maskReceiptItems(SAMPLE_BODY, new Set([1]), "(삭제됨)");
  assert.match(masked, /^02 \(삭제됨\)$/m);
  assert.doesNotMatch(masked, /커뮤니티 글 제목/);
  assert.doesNotMatch(masked, /본문 일부/);
  assert.match(masked, /01 키워드 A\n {3}요약 A/);
  assert.match(masked, /03 핫토픽 C\n {3}요약 C\n {3}출처 연합뉴스/);
  assert.match(masked, /합계 3건/);
  // 헤더의 "No.0007" 등은 항목으로 오인하지 않는다.
  assert.equal(maskReceiptItems(SAMPLE_BODY, new Set(), "x"), SAMPLE_BODY);
});

test("community keys map to post ids; other keys and junk are ignored", () => {
  assert.equal(communityPostIdFromKey("community:42"), 42);
  assert.equal(communityPostIdFromKey("expertPicks:7"), 7);
  assert.equal(communityPostIdFromKey("keyword:abc"), null);
  assert.equal(communityPostIdFromKey("community:1;DROP"), null);
  assert.deepEqual(
    normalizeContentKeys(["community:1", 5, "", "keyword:a", ...Array(20).fill("x")]),
    ["community:1", "keyword:a", ...Array(8).fill("x")],
  );
  assert.deepEqual(normalizeContentKeys(undefined), []);
});

