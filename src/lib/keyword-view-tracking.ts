import { createHmac } from "node:crypto";
import {
  claimKeywordViewEvent,
  getKeywordInLatestSnapshot,
  incrementKeywordViewCountBatch,
} from "@/lib/db/queries";

const VIEW_BUCKET_MS = 60 * 60 * 1000;
const MAX_KEYWORD_IDS = 20;
const KEYWORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function getViewerHash(request: Request): string | null {
  const secret = process.env.VIEW_EVENT_HMAC_SECRET?.trim();
  if (!secret) return null;

  // 네트워크 식별자는 메모리/DB 어디에도 원문으로 남기지 않는다.
  const fingerprint = `${getClientIp(request)}\n${request.headers.get("user-agent") ?? ""}`;
  return createHmac("sha256", secret).update(fingerprint).digest("hex");
}

function currentBucket(): Date {
  return new Date(Math.floor(Date.now() / VIEW_BUCKET_MS) * VIEW_BUCKET_MS);
}

export function normalizeKeywordIds(ids: unknown[]): string[] {
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => KEYWORD_ID_PATTERN.test(id)),
    ),
  ].slice(0, MAX_KEYWORD_IDS);
}

export async function trackKeywordViews(
  request: Request,
  keywordIds: string[],
): Promise<{ counted: number; valid: string[]; trackingEnabled: boolean }> {
  const viewerHash = getViewerHash(request);
  const valid = (
    await Promise.all(keywordIds.map((id) => getKeywordInLatestSnapshot(id)))
  ).flatMap((keyword) => (keyword ? [keyword.keyword_id] : []));

  // 비밀 키가 없을 때 조회수를 올리면 임의 POST로 순위를 조작할 수 있으므로 안전하게 집계를 중단한다.
  if (!viewerHash || valid.length === 0) {
    return { counted: 0, valid, trackingEnabled: Boolean(viewerHash) };
  }

  const bucket = currentBucket();
  const claimed = (
    await Promise.all(
      valid.map(async (keywordId) =>
        (await claimKeywordViewEvent(keywordId, viewerHash, bucket)) ? keywordId : null,
      ),
    )
  ).flatMap((keywordId) => (keywordId ? [keywordId] : []));

  if (claimed.length > 0) await incrementKeywordViewCountBatch(claimed);
  return { counted: claimed.length, valid, trackingEnabled: true };
}
