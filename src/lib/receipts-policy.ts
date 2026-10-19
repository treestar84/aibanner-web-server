import { createHmac, randomBytes } from "node:crypto";

// 영수증·flying 수치 정책. 앱(Flutter)의 receipt/flying 상수와 같은 값을 유지한다.
export const RECEIPT_BODY_MAX_CHARS = 6000;
export const RECEIPT_MAX_ITEMS = 10;
export const RECEIPT_DAILY_CAP = 20;
export const FLYING_SHARE_DAILY_CAP = 50;
export const CONTENT_KEY_MAX_CHARS = 200;

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// 공유 채널 화이트리스트. 모르는 값은 "system"으로 접는다 — 통계용 라벨일 뿐
// 카운트 여부에는 영향을 주지 않는다.
export const SHARE_CHANNELS = [
  "copy",
  "kakao",
  "x",
  "threads",
  "system",
] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export function normalizeShareChannel(raw: unknown): ShareChannel {
  if (typeof raw !== "string") return "system";
  const value = raw.trim().toLowerCase();
  return (SHARE_CHANNELS as readonly string[]).includes(value)
    ? (value as ShareChannel)
    : "system";
}

export function normalizeContentKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > CONTENT_KEY_MAX_CHARS) return null;
  return value;
}

export function generateReceiptCode(bytes: Buffer = randomBytes(CODE_LENGTH)): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function isValidReceiptCode(code: string): boolean {
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code);
}

// 카톡·슬랙·X 등은 링크를 붙여넣는 순간 미리보기용으로 페이지를 긁어 간다.
// 이걸 열람으로 세면 "보내기만 해도 +1"이 되므로 반드시 제외한다.
// LINE·다음·텔레그램 앱의 인앱 브라우저처럼 사람이 여는 UA는 걸리지 않도록
// 앱 이름 대신 크롤러 전용 토큰만 본다(kakaotalk-scrap, TelegramBot 등).
const LINK_PREVIEW_BOT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|preview|scrap|facebookexternalhit|whatsapp|slack-imgproxy|headless|curl|wget|python|axios|node-fetch|go-http/i;

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (ua.length === 0) return true;
  return LINK_PREVIEW_BOT_PATTERN.test(ua);
}

/// 열람 중복 제거용 방문자 해시. UA는 쉽게 바꿀 수 있어 IP만 쓴다(같은
/// IP는 영수증당 한 번). 비밀키가 없으면 집계를 끈다(null).
export function receiptVisitorHash(
  ip: string,
  secret: string | undefined = process.env.VIEW_EVENT_HMAC_SECRET,
): string | null {
  const key = secret?.trim();
  if (!key) return null;
  return createHmac("sha256", key).update(`receipt\n${ip}`).digest("hex");
}

export function kstDayBucket(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/// 영수증 발행 시 함께 받는 글 키 목록. 형식이 틀린 값은 버리고 최대 10개.
export function normalizeContentKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeContentKey)
    .filter((key): key is string => key !== null)
    .slice(0, RECEIPT_MAX_ITEMS);
}

/// 커뮤니티 글(사용자 글·에디터 픽) 키에서 게시글 id를 뽑는다. 아니면 null.
export function communityPostIdFromKey(key: string): number | null {
  const match = /^(community|expertPicks):(\d{1,12})$/.exec(key);
  return match ? Number(match[2]) : null;
}

const ITEM_HEADER = /^(\d{2}) /;
const DIVIDER = /^━+$/;

/// 영수증 본문에서 [removedIndexes](0부터) 번째 항목의 제목·요약·링크 줄을
/// [placeholder] 한 줄로 바꾼다. 항목은 두 번째 구분선 뒤 "01 제목" 줄로
/// 시작해 빈 줄이나 다음 구분선 전까지다.
export function maskReceiptItems(
  body: string,
  removedIndexes: ReadonlySet<number>,
  placeholder: string,
): string {
  if (removedIndexes.size === 0) return body;
  const lines = body.split("\n");
  const out: string[] = [];
  let dividers = 0;
  let skipping = false;
  for (const line of lines) {
    if (DIVIDER.test(line.trim())) {
      dividers += 1;
      skipping = false;
      out.push(line);
      continue;
    }
    if (dividers === 2) {
      const header = ITEM_HEADER.exec(line);
      if (header) {
        const index = Number(header[1]) - 1;
        skipping = removedIndexes.has(index);
        out.push(skipping ? `${header[1]} ${placeholder}` : line);
        continue;
      }
      if (line.trim() === "") skipping = false;
      if (skipping) continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

