import { NextResponse } from "next/server";
import { getMinSupportedVersion, isValidSemver } from "@/lib/api/app_version";
import { getAppConfigRows } from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const revalidate = 0;

// 앱 원격 구성. DB(app_config)가 1순위, 환경변수/기본값이 폴백.
// 클라이언트는 앱 시작 시 1회 + 주기적으로 이 값을 읽어 kill switch·공지·
// 강제 업데이트 기준을 갱신한다.

function sanitizeNotice(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id.length === 0) return null;
  const text = (key: string) => (typeof record[key] === "string" ? String(record[key]).slice(0, 500) : "");
  const titleKo = text("titleKo");
  if (titleKo.length === 0) return null;
  return {
    id: id.slice(0, 64),
    titleKo,
    titleEn: text("titleEn"),
    bodyKo: text("bodyKo"),
    bodyEn: text("bodyEn"),
    url: text("url"),
  };
}

function sanitizeFeatures(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (typeof flag === "boolean" && /^[a-zA-Z0-9_]{1,64}$/.test(key)) result[key] = flag;
  }
  return result;
}

export async function GET() {
  try {
    let rows: Record<string, unknown> = {};
    try {
      rows = await getAppConfigRows();
    } catch (err) {
      // DB 장애 시에도 config는 기본값으로 응답해야 앱이 정상 동작한다.
      console.error("[/api/v1/config] app_config 조회 실패 — 기본값 사용", err);
    }

    const dbMinVersion =
      typeof rows.min_supported_version === "string" ? rows.min_supported_version.trim() : "";
    const minSupportedVersion =
      dbMinVersion.length > 0 && isValidSemver(dbMinVersion)
        ? dbMinVersion
        : getMinSupportedVersion();

    return NextResponse.json(
      {
        minSupportedVersion,
        notice: sanitizeNotice(rows.notice),
        features: sanitizeFeatures(rows.features),
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    console.error("[/api/v1/config]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
