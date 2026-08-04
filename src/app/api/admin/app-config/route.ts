import { NextRequest, NextResponse } from "next/server";
import { isValidSemver } from "@/lib/api/app_version";
import {
  APP_CONFIG_KEYS,
  getAppConfigRows,
  setAppConfigValue,
  type AppConfigKey,
} from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const revalidate = 0;

// 관리자 전용 (미들웨어 Basic Auth 뒤). 앱 원격 구성 조회/수정.
// 사용 예:
//   curl -u admin:*** https://<host>/api/admin/app-config
//   curl -u admin:*** -X PUT -H 'Content-Type: application/json' \
//     -d '{"key":"features","value":{"youtube":false}}' https://<host>/api/admin/app-config

export async function GET() {
  try {
    const rows = await getAppConfigRows();
    return NextResponse.json({ config: rows, keys: APP_CONFIG_KEYS });
  } catch (err) {
    console.error("[/api/admin/app-config]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key : "";
    if (!(APP_CONFIG_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json(
        { error: `key must be one of: ${APP_CONFIG_KEYS.join(", ")}` },
        { status: 400 }
      );
    }
    const value: unknown = body?.value;

    // 세이프가드: 잘못된 min_supported_version이 저장되면 전체 사용자가
    // 강제 업데이트 다이얼로그에 갇힐 수 있으므로 쓰기 시점에 차단한다.
    if (key === "min_supported_version") {
      if (typeof value !== "string" || !isValidSemver(value)) {
        return NextResponse.json(
          { error: "min_supported_version must be a valid x.y.z semver string" },
          { status: 400 }
        );
      }
    }
    if (key === "features" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      return NextResponse.json({ error: "features must be an object" }, { status: 400 });
    }
    if (key === "notice" && value !== null && (typeof value !== "object" || Array.isArray(value))) {
      return NextResponse.json({ error: "notice must be an object or null" }, { status: 400 });
    }

    await setAppConfigValue(key as AppConfigKey, value);
    const rows = await getAppConfigRows();
    return NextResponse.json({ ok: true, config: rows });
  } catch (err) {
    console.error("[/api/admin/app-config]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
