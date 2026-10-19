import { NextRequest, NextResponse } from "next/server";
import { requirePostToken } from "@/lib/post-token-auth";
import {
  getFlyingTotals,
  normalizeContentKey,
  normalizeShareChannel,
  recordFlyingShare,
} from "@/lib/receipts";

export const runtime = "nodejs";
export const revalidate = 0;

// 앱 안에서 복사·공유 대상 앱 선택이 일어날 때마다 호출된다. 실제 전송 여부는
// OS가 알려주지 않으므로, 같은 콘텐츠는 하루 1회·하루 최대 N건으로 묶어 남용을 막는다.
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;

    const payload = await req.json().catch(() => null);
    const contentKey = normalizeContentKey(payload?.contentKey);
    if (!contentKey) {
      return NextResponse.json({ error: "contentKey is required" }, { status: 400 });
    }
    const counted = await recordFlyingShare(
      auth.deviceId,
      contentKey,
      normalizeShareChannel(payload?.channel),
    );
    return NextResponse.json({ counted, ...(await getFlyingTotals(auth.deviceId)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/flying/shares][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
