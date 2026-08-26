import { createHmac } from "node:crypto";

// keyword/expert-pick 조회수 트래킹과 동일한 익명화 방식을 그대로 재사용한다
// (IP+UA를 HMAC-SHA256으로 해시 — 원문은 어디에도 남기지 않는다).
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

export function getViewerHash(request: Request): string | null {
  const secret = process.env.VIEW_EVENT_HMAC_SECRET?.trim();
  if (!secret) return null;
  const fingerprint = `${getClientIp(request)}\n${request.headers.get("user-agent") ?? ""}`;
  return createHmac("sha256", secret).update(fingerprint).digest("hex");
}

// Flutter의 LikedContentSection.name과 1:1로 맞춘 값 — 클라이언트가 매핑
// 테이블 없이 그대로 넘길 수 있게 한다.
export const LIKE_CONTENT_TYPES = [
  "trends",
  "burning",
  "hotTopics",
  "expertPicks",
] as const;

export type LikeContentType = (typeof LIKE_CONTENT_TYPES)[number];

export function isValidLikeContentType(value: string): value is LikeContentType {
  return (LIKE_CONTENT_TYPES as readonly string[]).includes(value);
}

export const LIKE_CONTENT_ID_MAX_LENGTH = 128;
export const LIKE_COUNTS_MAX_BATCH_IDS = 50;
