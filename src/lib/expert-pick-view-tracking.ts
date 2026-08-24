import { createHmac } from "node:crypto";
import {
  claimExpertPickViewEvent,
  getExpertPickById,
  incrementExpertPickViewCountBatch,
} from "@/lib/db/queries";

export { normalizeExpertPickIds } from "@/lib/expert-pick-id-normalization";

const VIEW_BUCKET_MS = 60 * 60 * 1000;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function getViewerHash(request: Request): string | null {
  const secret = process.env.VIEW_EVENT_HMAC_SECRET?.trim();
  if (!secret) return null;
  const fingerprint = `${getClientIp(request)}\n${request.headers.get("user-agent") ?? ""}`;
  return createHmac("sha256", secret).update(fingerprint).digest("hex");
}

function currentBucket(): Date {
  return new Date(Math.floor(Date.now() / VIEW_BUCKET_MS) * VIEW_BUCKET_MS);
}

export async function trackExpertPickViews(
  request: Request,
  ids: number[],
): Promise<{ counted: number; valid: number[]; trackingEnabled: boolean }> {
  const viewerHash = getViewerHash(request);
  const valid = (
    await Promise.all(ids.map(async (id) => ((await getExpertPickById(id)) ? id : null)))
  ).filter((id): id is number => id !== null);

  if (!viewerHash || valid.length === 0) {
    return { counted: 0, valid, trackingEnabled: Boolean(viewerHash) };
  }

  const bucket = currentBucket();
  const claimed = (
    await Promise.all(
      valid.map(async (id) => ((await claimExpertPickViewEvent(id, viewerHash, bucket)) ? id : null)),
    )
  ).filter((id): id is number => id !== null);

  if (claimed.length > 0) await incrementExpertPickViewCountBatch(claimed);
  return { counted: claimed.length, valid, trackingEnabled: true };
}
