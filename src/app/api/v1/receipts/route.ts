import { NextRequest, NextResponse } from "next/server";
import { requirePostToken } from "@/lib/post-token-auth";
import {
  createReceipt,
  normalizeContentKeys,
  RECEIPT_BODY_MAX_CHARS,
  RECEIPT_MAX_ITEMS,
} from "@/lib/receipts";

export const runtime = "nodejs";
export const revalidate = 0;

// 앱이 발행한 영수증 본문을 저장하고 공개 링크(/r/{code})용 코드를 돌려준다.
// 링크를 다른 사람이 열면 발행자의 flying에 더해진다(/r/[code]/page.tsx).
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;

    const payload = await req.json().catch(() => null);
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    const itemCount = Number(payload?.itemCount);
    if (!body) return NextResponse.json({ error: "body is required" }, { status: 400 });
    if (body.length > RECEIPT_BODY_MAX_CHARS) {
      return NextResponse.json(
        { error: `body exceeds ${RECEIPT_BODY_MAX_CHARS} characters` },
        { status: 400 },
      );
    }
    if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > RECEIPT_MAX_ITEMS) {
      return NextResponse.json(
        { error: `itemCount must be between 1 and ${RECEIPT_MAX_ITEMS}` },
        { status: 400 },
      );
    }

    // 예전 앱은 contentKeys를 보내지 않는다(빈 목록 = 가릴 항목 판단 안 함).
    const contentKeys = normalizeContentKeys(payload?.contentKeys);
    const result = await createReceipt(auth.deviceId, body, itemCount, contentKeys);
    if ("error" in result) {
      return NextResponse.json({ error: "Daily receipt limit reached" }, { status: 429 });
    }
    return NextResponse.json({ code: result.code }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/receipts][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
