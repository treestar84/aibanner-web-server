import { sql } from "@/lib/db/client";
import type { ClientMeta, ClientErrorItem, AnalyticsEventItem } from "@/lib/api/client_reports";

// ─── 테이블 보장 ──────────────────────────────────────────────────────────────
// schema.sql이 정본이지만, 마이그레이션 실행 전에 배포가 먼저 나가도
// 엔드포인트가 500을 내지 않도록 인스턴스당 1회 idempotent DDL을 수행한다.

let ensurePromise: Promise<void> | null = null;

export function ensureTelemetryTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS app_config (
          key        TEXT        PRIMARY KEY,
          value      JSONB       NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS client_error_groups (
          day          DATE        NOT NULL,
          fingerprint  TEXT        NOT NULL,
          app_version  TEXT        NOT NULL DEFAULT '',
          platform     TEXT        NOT NULL DEFAULT '',
          os_version   TEXT        NOT NULL DEFAULT '',
          device_model TEXT        NOT NULL DEFAULT '',
          message      TEXT        NOT NULL DEFAULT '',
          sample_stack TEXT        NOT NULL DEFAULT '',
          is_fatal     BOOLEAN     NOT NULL DEFAULT FALSE,
          count        BIGINT      NOT NULL DEFAULT 0,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (day, fingerprint, app_version)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS analytics_event_daily (
          day         DATE   NOT NULL,
          name        TEXT   NOT NULL,
          app_version TEXT   NOT NULL DEFAULT '',
          count       BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (day, name, app_version)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS analytics_client_daily (
          day         DATE NOT NULL,
          client_id   TEXT NOT NULL,
          platform    TEXT NOT NULL DEFAULT '',
          app_version TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (day, client_id)
        )`;
    })().catch((err) => {
      ensurePromise = null; // 실패 시 다음 요청에서 재시도
      throw err;
    });
  }
  return ensurePromise;
}

// ─── app_config ───────────────────────────────────────────────────────────────

export const APP_CONFIG_KEYS = ["min_supported_version", "notice", "features"] as const;
export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

export async function getAppConfigRows(): Promise<Record<string, unknown>> {
  await ensureTelemetryTables();
  const rows = (await sql`SELECT key, value FROM app_config`) as {
    key: string;
    value: unknown;
  }[];
  const result: Record<string, unknown> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function setAppConfigValue(key: AppConfigKey, value: unknown): Promise<void> {
  await ensureTelemetryTables();
  await sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
}

// ─── 에러 리포트 ──────────────────────────────────────────────────────────────

export async function recordClientErrors(
  meta: ClientMeta,
  items: ClientErrorItem[]
): Promise<number> {
  await ensureTelemetryTables();
  let accepted = 0;
  for (const item of items) {
    await sql`
      INSERT INTO client_error_groups (
        day, fingerprint, app_version, platform, os_version, device_model,
        message, sample_stack, is_fatal, count
      ) VALUES (
        CURRENT_DATE, ${item.fingerprint}, ${meta.appVersion}, ${meta.platform},
        ${meta.osVersion}, ${meta.deviceModel}, ${item.message}, ${item.stack},
        ${item.isFatal}, ${item.count}
      )
      ON CONFLICT (day, fingerprint, app_version) DO UPDATE SET
        count = client_error_groups.count + EXCLUDED.count,
        is_fatal = client_error_groups.is_fatal OR EXCLUDED.is_fatal,
        last_seen_at = NOW()`;
    accepted += 1;
  }
  return accepted;
}

// ─── 애널리틱스 ───────────────────────────────────────────────────────────────

export async function recordAnalyticsEvents(
  meta: ClientMeta,
  items: AnalyticsEventItem[]
): Promise<number> {
  await ensureTelemetryTables();
  await sql`
    INSERT INTO analytics_client_daily (day, client_id, platform, app_version)
    VALUES (CURRENT_DATE, ${meta.clientId}, ${meta.platform}, ${meta.appVersion})
    ON CONFLICT (day, client_id) DO NOTHING`;
  for (const item of items) {
    await sql`
      INSERT INTO analytics_event_daily (day, name, app_version, count)
      VALUES (CURRENT_DATE, ${item.name}, ${meta.appVersion}, ${item.count})
      ON CONFLICT (day, name, app_version) DO UPDATE SET
        count = analytics_event_daily.count + EXCLUDED.count`;
  }
  return items.length;
}

// ─── 관리자 조회 ──────────────────────────────────────────────────────────────

export async function getTelemetrySummary(days: number) {
  await ensureTelemetryTables();
  const [errorGroups, eventDaily, dauDaily] = await Promise.all([
    sql`
      SELECT day, fingerprint, app_version, platform, message, sample_stack,
             is_fatal, count, first_seen_at, last_seen_at
      FROM client_error_groups
      WHERE day >= CURRENT_DATE - ${days}::int
      ORDER BY count DESC
      LIMIT 50`,
    sql`
      SELECT day, name, SUM(count)::bigint AS count
      FROM analytics_event_daily
      WHERE day >= CURRENT_DATE - ${days}::int
      GROUP BY day, name
      ORDER BY day DESC, count DESC`,
    sql`
      SELECT day, COUNT(*)::bigint AS dau
      FROM analytics_client_daily
      WHERE day >= CURRENT_DATE - ${days}::int
      GROUP BY day
      ORDER BY day DESC`,
  ]);
  return { errorGroups, eventDaily, dauDaily };
}

// ─── 보존 정책 ────────────────────────────────────────────────────────────────
// 원시 client_id 목록은 90일, 집계는 400일 보존. 크론 retention 패스에서 호출.

export async function pruneTelemetry(): Promise<void> {
  await ensureTelemetryTables();
  await sql`DELETE FROM analytics_client_daily WHERE day < CURRENT_DATE - 90`;
  await sql`DELETE FROM analytics_event_daily WHERE day < CURRENT_DATE - 400`;
  await sql`DELETE FROM client_error_groups WHERE day < CURRENT_DATE - 90`;
}
