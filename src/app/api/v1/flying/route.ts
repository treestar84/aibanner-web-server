import { NextRequest, NextResponse } from "next/server";
import { requirePostToken } from "@/lib/post-token-auth";
import { getFlyingTotals } from "@/lib/receipts";

export const runtime = "nodejs";
export const revalidate = 0;

// 내 flying = 앱에서 공유·복사한 횟수(shares) + 내 영수증 링크를 남이 연 횟수(opens).
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json(await getFlyingTotals(auth.deviceId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/flying][GET]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
