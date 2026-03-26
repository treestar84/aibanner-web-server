import { sql } from "./client";
import {
  buildExtendedManualKeywordWindow,
  buildManualKeywordId,
  buildManualKeywordWindow,
  normalizeManualKeywordText,
  sanitizeManualKeywordTtlHours,
} from "@/lib/manual-keywords";
import type { PipelineMode } from "@/lib/pipeline/mode";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Snapshot {
  snapshot_id: string;
  pipeline_mode: PipelineMode;
  updated_at_utc: string;
  next_update_at_utc: string;
  created_at: string;
}

export interface Keyword {
  snapshot_id: string;
  keyword_id: string;
  keyword: string;
  keyword_ko: string;
  keyword_en: string;
  rank: number;
  delta_rank: number;
  is_new: boolean;
  score: number;
  score_recency: number;
  score_frequency: number;
  score_authority: number;
  score_velocity: number;
  score_engagement: number;
  score_internal: number;
  summary_short: string;
  summary_short_en: string;
  primary_type: "news" | "social" | "data" | "web" | "video" | "image";
  top_source_title: string | null;
  top_source_title_ko: string | null;
  top_source_title_en: string | null;
  top_source_url: string | null;
  top_source_domain: string | null;
  top_source_image_url: string | null;
  created_at: string;
}

export interface Source {
  id: number;
  snapshot_id: string;
  keyword_id: string;
  type: "news" | "social" | "data" | "web" | "video" | "image";
  title: string;
  url: string;
  domain: string;
  published_at_utc: string | null;
  snippet: string | null;
  image_url: string;
  title_ko: string | null;
  title_en: string | null;
  created_at: string;
}

export interface HotKeyword extends Keyword {
  snapshot_updated_at_utc: string;
  view_count: number;
  last_viewed_at: string | null;
}

export interface RetentionCounts {
  aggregatedRows: number;
  deletedDailyStats: number;
  deletedSources: number;
  deletedKeywords: number;
  deletedSnapshots: number;
  deletedKeywordAliases: number;
  deletedKeywordViewCounts: number;
}

export interface SourceIngestionState {
  source_key: string;
  last_success_at_utc: string | null;
  last_published_at_utc: string | null;
  last_item_count: number;
  last_window_hours: number;
  updated_at: string;
}

export interface ManualKeyword {
  id: number;
  keyword: string;
  mode: PipelineMode;
  ttl_hours: number;
  enabled: boolean;
  starts_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  remaining_seconds: number;
  is_active: boolean;
}

interface ManualKeywordRow {
  id: number;
  keyword: string;
  mode: PipelineMode;
  ttl_hours: number;
  enabled: boolean;
  starts_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  remaining_seconds: number | string;
  is_active: boolean;
}

function toManualKeyword(row: ManualKeywordRow): ManualKeyword {
  return {
    ...row,
    remaining_seconds: Math.max(0, Number(row.remaining_seconds ?? 0)),
  };
}

// ─── Manual keyword queries ───────────────────────────────────────────────────

export async function listManualKeywords(mode?: PipelineMode): Promise<ManualKeyword[]> {
  const rows = mode
    ? ((await sql`
      SELECT
        mk.*,
        GREATEST(0, EXTRACT(EPOCH FROM (mk.expires_at - NOW())))::int AS remaining_seconds,
        (
          mk.enabled = TRUE
          AND mk.starts_at <= NOW()
          AND mk.expires_at > NOW()
        ) AS is_active
      FROM manual_keywords mk
      WHERE mk.mode = ${mode}
      ORDER BY mk.enabled DESC, mk.expires_at DESC, mk.created_at DESC
      LIMIT 300
    `) as ManualKeywordRow[])
    : ((await sql`
      SELECT
        mk.*,
        GREATEST(0, EXTRACT(EPOCH FROM (mk.expires_at - NOW())))::int AS remaining_seconds,
        (
          mk.enabled = TRUE
          AND mk.starts_at <= NOW()
          AND mk.expires_at > NOW()
        ) AS is_active
      FROM manual_keywords mk
      ORDER BY mk.enabled DESC, mk.expires_at DESC, mk.created_at DESC
      LIMIT 300
    `) as ManualKeywordRow[]);

  return rows.map(toManualKeyword);
}

export async function getActiveManualKeywords(
  mode: PipelineMode
): Promise<ManualKeyword[]> {
  const rows = (await sql`
    SELECT
      mk.*,
      GREATEST(0, EXTRACT(EPOCH FROM (mk.expires_at - NOW())))::int AS remaining_seconds,
      (
        mk.enabled = TRUE
        AND mk.starts_at <= NOW()
        AND mk.expires_at > NOW()
      ) AS is_active
    FROM manual_keywords mk
    WHERE mk.mode = ${mode}
      AND mk.enabled = TRUE
      AND mk.starts_at <= NOW()
      AND mk.expires_at > NOW()
    ORDER BY mk.created_at DESC, mk.id DESC
  `) as ManualKeywordRow[];

  return rows.map(toManualKeyword);
}

export async function getActiveManualKeywordIds(
  mode: PipelineMode
): Promise<Set<string>> {
  const items = await getActiveManualKeywords(mode);
  return new Set(items.map((item) => buildManualKeywordId(mode, item.keyword)));
}

export async function getManualKeywordById(id: number): Promise<ManualKeyword | null> {
  const rows = (await sql`
    SELECT
      mk.*,
      GREATEST(0, EXTRACT(EPOCH FROM (mk.expires_at - NOW())))::int AS remaining_seconds,
      (
        mk.enabled = TRUE
        AND mk.starts_at <= NOW()
        AND mk.expires_at > NOW()
      ) AS is_active
    FROM manual_keywords mk
    WHERE mk.id = ${id}
    LIMIT 1
  `) as ManualKeywordRow[];

  return rows[0] ? toManualKeyword(rows[0]) : null;
}

export async function upsertManualKeyword(input: {
  keyword: string;
  mode?: PipelineMode;
  ttlHours?: number;
}): Promise<ManualKeyword> {
  const keyword = normalizeManualKeywordText(input.keyword);
  if (!keyword) {
    throw new Error("keyword is required");
  }

  const mode = input.mode ?? "realtime";
  const ttlHours = sanitizeManualKeywordTtlHours(input.ttlHours ?? 6);
  const window = buildManualKeywordWindow(ttlHours);

  const existingRows = (await sql`
    SELECT id
    FROM manual_keywords
    WHERE mode = ${mode}
      AND lower(keyword) = lower(${keyword})
    ORDER BY enabled DESC, expires_at DESC, id DESC
    LIMIT 1
  `) as { id: number }[];
  const existingId = existingRows[0]?.id;

  const rows = existingId
    ? ((await sql`
      UPDATE manual_keywords
      SET keyword = ${keyword},
          ttl_hours = ${ttlHours},
          enabled = TRUE,
          starts_at = ${window.startsAt},
          expires_at = ${window.expiresAt},
          updated_at = NOW()
      WHERE id = ${existingId}
      RETURNING
        *,
        GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW())))::int AS remaining_seconds,
        (
          enabled = TRUE
          AND starts_at <= NOW()
          AND expires_at > NOW()
        ) AS is_active
    `) as ManualKeywordRow[])
    : ((await sql`
      INSERT INTO manual_keywords (
        keyword,
        mode,
        ttl_hours,
        enabled,
        starts_at,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        ${keyword},
        ${mode},
        ${ttlHours},
        TRUE,
        ${window.startsAt},
        ${window.expiresAt},
        NOW(),
        NOW()
      )
      RETURNING
        *,
        GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW())))::int AS remaining_seconds,
        (
          enabled = TRUE
          AND starts_at <= NOW()
          AND expires_at > NOW()
        ) AS is_active
    `) as ManualKeywordRow[]);

  return toManualKeyword(rows[0]);
}

export async function extendManualKeyword(
  id: number,
  ttlHours: number
): Promise<ManualKeyword | null> {
  const current = await getManualKeywordById(id);
  if (!current) return null;

  const sanitizedTtlHours = sanitizeManualKeywordTtlHours(ttlHours);
  const window = buildExtendedManualKeywordWindow(
    {
      enabled: current.enabled,
      startsAt: current.starts_at,
      expiresAt: current.expires_at,
    },
    sanitizedTtlHours
  );

  const rows = (await sql`
    UPDATE manual_keywords
    SET ttl_hours = ${sanitizedTtlHours},
        enabled = TRUE,
        starts_at = ${window.startsAt},
        expires_at = ${window.expiresAt},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      *,
      GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW())))::int AS remaining_seconds,
      (
        enabled = TRUE
        AND starts_at <= NOW()
        AND expires_at > NOW()
      ) AS is_active
  `) as ManualKeywordRow[];

  return rows[0] ? toManualKeyword(rows[0]) : null;
}

export async function setManualKeywordEnabled(
  id: number,
  enabled: boolean
): Promise<ManualKeyword | null> {
  const current = await getManualKeywordById(id);
  if (!current) return null;

  const shouldRestartWindow =
    enabled &&
    new Date(current.expires_at).getTime() <= Date.now();
  const window = shouldRestartWindow
    ? buildManualKeywordWindow(current.ttl_hours)
    : null;

  const rows = (await sql`
    UPDATE manual_keywords
    SET enabled = ${enabled},
        starts_at = CASE
          WHEN ${enabled} AND ${window?.startsAt ?? null} IS NOT NULL THEN ${window?.startsAt ?? null}
          ELSE starts_at
        END,
        expires_at = CASE
          WHEN ${enabled} AND ${window?.expiresAt ?? null} IS NOT NULL THEN ${window?.expiresAt ?? null}
          ELSE expires_at
        END,
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      *,
      GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW())))::int AS remaining_seconds,
      (
        enabled = TRUE
        AND starts_at <= NOW()
        AND expires_at > NOW()
      ) AS is_active
  `) as ManualKeywordRow[];

  return rows[0] ? toManualKeyword(rows[0]) : null;
}

export async function deleteManualKeyword(id: number): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM manual_keywords
    WHERE id = ${id}
    RETURNING id
  `) as { id: number }[];

  return rows.length > 0;
}

// ─── Snapshot queries ─────────────────────────────────────────────────────────

export async function getLatestSnapshot(
  mode?: PipelineMode
): Promise<Snapshot | null> {
  const rows = mode
    ? ((await sql`
      SELECT * FROM snapshots
      WHERE pipeline_mode = ${mode}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Snapshot[])
    : ((await sql`
      SELECT * FROM snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `) as Snapshot[]);
  return rows[0] ?? null;
}

export async function getLatestSnapshotWithKeywords(
  mode?: PipelineMode
): Promise<Snapshot | null> {
  const rows = mode
    ? ((await sql`
      SELECT s.* FROM snapshots s
      WHERE s.pipeline_mode = ${mode}
        AND EXISTS (
          SELECT 1 FROM keywords k
          WHERE k.snapshot_id = s.snapshot_id
        )
      ORDER BY s.created_at DESC
      LIMIT 1
    `) as Snapshot[])
    : ((await sql`
      SELECT s.* FROM snapshots s
      WHERE EXISTS (
        SELECT 1 FROM keywords k
        WHERE k.snapshot_id = s.snapshot_id
      )
      ORDER BY s.created_at DESC
      LIMIT 1
    `) as Snapshot[]);
  return rows[0] ?? null;
}

export async function getRecentSnapshots(
  limit: number,
  mode?: PipelineMode
): Promise<Snapshot[]> {
  if (mode) {
    return (await sql`
      SELECT * FROM snapshots
      WHERE pipeline_mode = ${mode}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Snapshot[];
  }

  return (await sql`
    SELECT * FROM snapshots
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as Snapshot[];
}

export async function getSourceIngestionStates(): Promise<
  SourceIngestionState[]
> {
  return (await sql`
    SELECT *
    FROM source_ingestion_state
  `) as SourceIngestionState[];
}

export async function upsertSourceIngestionState(state: {
  source_key: string;
  last_success_at_utc: string;
  last_published_at_utc: string | null;
  last_item_count: number;
  last_window_hours: number;
}): Promise<void> {
  await sql`
    INSERT INTO source_ingestion_state (
      source_key,
      last_success_at_utc,
      last_published_at_utc,
      last_item_count,
      last_window_hours,
      updated_at
    )
    VALUES (
      ${state.source_key},
      ${state.last_success_at_utc},
      ${state.last_published_at_utc},
      ${state.last_item_count},
      ${state.last_window_hours},
      NOW()
    )
    ON CONFLICT (source_key) DO UPDATE
    SET last_success_at_utc = EXCLUDED.last_success_at_utc,
        last_published_at_utc = EXCLUDED.last_published_at_utc,
        last_item_count = EXCLUDED.last_item_count,
        last_window_hours = EXCLUDED.last_window_hours,
        updated_at = NOW()
  `;
}

export async function findCachedKeyword(
  keywordId: string,
  recentSnapshotIds: string[]
): Promise<{ keyword: Keyword; sources: Source[] } | null> {
  if (recentSnapshotIds.length === 0) return null;

  const rows = (await sql`
    SELECT k.* FROM keywords k
    WHERE k.keyword_id = ${keywordId}
      AND k.snapshot_id = ANY(${recentSnapshotIds})
    ORDER BY k.created_at DESC
    LIMIT 1
  `) as Keyword[];

  if (!rows[0]) return null;

  const sources = await getSourcesByKeyword(rows[0].snapshot_id, keywordId);
  if (sources.length === 0) return null;

  return { keyword: rows[0], sources };
}

export async function getSnapshotById(
  snapshotId: string
): Promise<Snapshot | null> {
  const rows = (await sql`
    SELECT * FROM snapshots WHERE snapshot_id = ${snapshotId}
  `) as Snapshot[];
  return rows[0] ?? null;
}

export async function insertSnapshot(snapshot: Omit<Snapshot, "created_at">): Promise<void> {
  await sql`
    INSERT INTO snapshots (snapshot_id, pipeline_mode, updated_at_utc, next_update_at_utc)
    VALUES (
      ${snapshot.snapshot_id},
      ${snapshot.pipeline_mode},
      ${snapshot.updated_at_utc},
      ${snapshot.next_update_at_utc}
    )
    ON CONFLICT (snapshot_id) DO NOTHING
  `;
}

export async function deleteSnapshotIfEmpty(snapshotId: string): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM snapshots s
    WHERE s.snapshot_id = ${snapshotId}
      AND NOT EXISTS (
        SELECT 1 FROM keywords k
        WHERE k.snapshot_id = s.snapshot_id
      )
    RETURNING s.snapshot_id
  `) as { snapshot_id: string }[];

  return rows.length > 0;
}

// ─── Keyword queries ──────────────────────────────────────────────────────────

export async function getTopKeywords(
  snapshotId: string,
  limit = 10
): Promise<Keyword[]> {
  return (await sql`
    SELECT * FROM keywords
    WHERE snapshot_id = ${snapshotId}
    ORDER BY rank ASC
    LIMIT ${limit}
  `) as Keyword[];
}

export async function getHotKeywords(
  lifecycleDays: number,
  limit = 10,
  topRankLimit = 10,
  mode?: PipelineMode
): Promise<HotKeyword[]> {
  if (mode) {
    return (await sql`
      WITH active_keyword_ids AS (
        SELECT DISTINCT k.keyword_id
        FROM keywords k
        JOIN snapshots s ON s.snapshot_id = k.snapshot_id
        WHERE k.rank <= ${topRankLimit}
          AND s.pipeline_mode = ${mode}
          AND s.created_at >= NOW() - (${lifecycleDays} * INTERVAL '1 day')
      ),
      latest_keywords AS (
        SELECT DISTINCT ON (k.keyword_id)
          k.*,
          s.updated_at_utc AS snapshot_updated_at_utc
        FROM keywords k
        JOIN snapshots s ON s.snapshot_id = k.snapshot_id
        JOIN active_keyword_ids a ON a.keyword_id = k.keyword_id
        WHERE s.pipeline_mode = ${mode}
        ORDER BY k.keyword_id,
          (CASE WHEN k.summary_short IS NOT NULL AND k.summary_short != '' THEN 0 ELSE 1 END),
          s.created_at DESC
      )
      SELECT
        lk.*,
        COALESCE(vc.view_count, 0)::int AS view_count,
        vc.last_viewed_at
      FROM latest_keywords lk
      LEFT JOIN keyword_view_counts vc ON vc.keyword_id = lk.keyword_id
      ORDER BY
        COALESCE(vc.view_count, 0) DESC,
        vc.last_viewed_at DESC NULLS LAST,
        lk.rank ASC
      LIMIT ${limit}
    `) as HotKeyword[];
  }

  return (await sql`
    WITH active_keyword_ids AS (
      SELECT DISTINCT k.keyword_id
      FROM keywords k
      JOIN snapshots s ON s.snapshot_id = k.snapshot_id
      WHERE k.rank <= ${topRankLimit}
        AND s.created_at >= NOW() - (${lifecycleDays} * INTERVAL '1 day')
    ),
    latest_keywords AS (
      SELECT DISTINCT ON (k.keyword_id)
        k.*,
        s.updated_at_utc AS snapshot_updated_at_utc
      FROM keywords k
      JOIN snapshots s ON s.snapshot_id = k.snapshot_id
      JOIN active_keyword_ids a ON a.keyword_id = k.keyword_id
      ORDER BY k.keyword_id,
        (CASE WHEN k.summary_short IS NOT NULL AND k.summary_short != '' THEN 0 ELSE 1 END),
        s.created_at DESC
    )
    SELECT
      lk.*,
      COALESCE(vc.view_count, 0)::int AS view_count,
      vc.last_viewed_at
    FROM latest_keywords lk
    LEFT JOIN keyword_view_counts vc ON vc.keyword_id = lk.keyword_id
    ORDER BY
      COALESCE(vc.view_count, 0) DESC,
      vc.last_viewed_at DESC NULLS LAST,
      lk.rank ASC
    LIMIT ${limit}
  `) as HotKeyword[];
}

export async function getKeywordById(
  keywordId: string,
  snapshotId: string
): Promise<Keyword | null> {
  const rows = (await sql`
    SELECT * FROM keywords
    WHERE keyword_id = ${keywordId} AND snapshot_id = ${snapshotId}
  `) as Keyword[];
  return rows[0] ?? null;
}

export async function getKeywordInLatestSnapshot(
  keywordId: string
): Promise<Keyword | null> {
  const rows = (await sql`
    SELECT k.* FROM keywords k
    JOIN snapshots s ON k.snapshot_id = s.snapshot_id
    WHERE k.keyword_id = ${keywordId}
    ORDER BY
      (CASE WHEN k.summary_short IS NOT NULL AND k.summary_short != '' THEN 0 ELSE 1 END),
      s.created_at DESC
    LIMIT 1
  `) as Keyword[];
  return rows[0] ?? null;
}

export async function insertKeyword(keyword: Omit<Keyword, "created_at">): Promise<void> {
  await sql`
    INSERT INTO keywords (
      snapshot_id, keyword_id, keyword, keyword_ko, keyword_en, rank, delta_rank, is_new,
      score, score_recency, score_frequency, score_authority, score_velocity, score_engagement, score_internal,
      summary_short, summary_short_en, primary_type,
      top_source_title, top_source_title_ko, top_source_title_en,
      top_source_url, top_source_domain, top_source_image_url
    ) VALUES (
      ${keyword.snapshot_id}, ${keyword.keyword_id}, ${keyword.keyword},
      ${keyword.keyword_ko}, ${keyword.keyword_en},
      ${keyword.rank}, ${keyword.delta_rank}, ${keyword.is_new},
      ${keyword.score}, ${keyword.score_recency}, ${keyword.score_frequency},
      ${keyword.score_authority}, ${keyword.score_velocity}, ${keyword.score_engagement}, ${keyword.score_internal},
      ${keyword.summary_short}, ${keyword.summary_short_en}, ${keyword.primary_type},
      ${keyword.top_source_title}, ${keyword.top_source_title_ko}, ${keyword.top_source_title_en},
      ${keyword.top_source_url},
      ${keyword.top_source_domain}, ${keyword.top_source_image_url}
    )
    ON CONFLICT (snapshot_id, keyword_id) DO NOTHING
  `;
}

function normalizeAlias(alias: string): string {
  return alias.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function detectAliasLang(alias: string): "ko" | "en" {
  if (/[\uAC00-\uD7AF\u3130-\u318F\u1100-\u11FF]/.test(alias)) return "ko";
  return "en";
}

export async function upsertKeywordAliases(
  canonicalKeywordId: string,
  aliases: string[]
): Promise<void> {
  const normalizedCanonicalId = canonicalKeywordId.trim();
  if (!normalizedCanonicalId) return;

  const dedupedAliases = [...new Set(
    aliases
      .map(normalizeAlias)
      .filter((alias) => alias.length > 0)
  )].slice(0, 30);
  if (dedupedAliases.length === 0) return;

  await Promise.all(
    dedupedAliases.map((alias) =>
      sql`
        INSERT INTO keyword_aliases (
          canonical_keyword_id,
          alias,
          lang
        )
        VALUES (
          ${normalizedCanonicalId},
          ${alias},
          ${detectAliasLang(alias)}
        )
        ON CONFLICT (canonical_keyword_id, alias) DO NOTHING
      `
    )
  );
}

export async function getPreviousRanks(
  snapshotId: string,
  keywordIds: string[]
): Promise<Map<string, number>> {
  if (keywordIds.length === 0) return new Map();

  const rows = (await sql`
    SELECT k.keyword_id, k.rank
    FROM keywords k
    WHERE k.keyword_id = ANY(${keywordIds})
      AND k.snapshot_id = ${snapshotId}
  `) as { keyword_id: string; rank: number }[];

  const map = new Map<string, number>();
  for (const row of rows) {
    if (!map.has(row.keyword_id)) {
      map.set(row.keyword_id, row.rank);
    }
  }
  return map;
}

/** 최근 N개 스냅샷에서 각 keywordId의 rank를 조회 (cross-snapshot trending용) */
export async function getRankHistory(
  snapshotIds: string[],
  keywordIds: string[]
): Promise<Map<string, number[]>> {
  if (snapshotIds.length === 0 || keywordIds.length === 0) return new Map();

  const rows = (await sql`
    SELECT k.keyword_id, k.snapshot_id, k.rank
    FROM keywords k
    WHERE k.keyword_id = ANY(${keywordIds})
      AND k.snapshot_id = ANY(${snapshotIds})
    ORDER BY k.created_at DESC
  `) as { keyword_id: string; snapshot_id: string; rank: number }[];

  const result = new Map<string, number[]>();

  for (const row of rows) {
    if (!result.has(row.keyword_id)) {
      result.set(row.keyword_id, []);
    }
    result.get(row.keyword_id)!.push(row.rank);
  }

  // 각 키워드의 rank를 스냅샷 시간순 정렬 (최신 먼저)
  for (const [, ranks] of result) {
    ranks.sort((a, b) => a - b); // 이미 ORDER BY DESC로 가져왔으므로 그대로
  }

  return result;
}

// ─── Source queries ───────────────────────────────────────────────────────────

export async function getSourcesByKeyword(
  snapshotId: string,
  keywordId: string
): Promise<Source[]> {
  return (await sql`
    SELECT * FROM sources
    WHERE snapshot_id = ${snapshotId} AND keyword_id = ${keywordId}
    ORDER BY type, id ASC
  `) as Source[];
}

export async function insertSource(
  source: Omit<Source, "id" | "created_at">
): Promise<void> {
  await sql`
    INSERT INTO sources (snapshot_id, keyword_id, type, title, url, domain, published_at_utc, snippet, image_url, title_ko, title_en)
    VALUES (
      ${source.snapshot_id}, ${source.keyword_id}, ${source.type},
      ${source.title}, ${source.url}, ${source.domain},
      ${source.published_at_utc}, ${source.snippet}, ${source.image_url},
      ${source.title_ko ?? null}, ${source.title_en ?? null}
    )
    ON CONFLICT (snapshot_id, keyword_id, type, url)
    DO UPDATE SET
      title = EXCLUDED.title,
      domain = EXCLUDED.domain,
      published_at_utc = EXCLUDED.published_at_utc,
      snippet = EXCLUDED.snippet,
      image_url = EXCLUDED.image_url,
      title_ko = EXCLUDED.title_ko,
      title_en = EXCLUDED.title_en
  `;
}

// ─── Retention / archival queries ─────────────────────────────────────────────

export async function upsertKeywordDailyStats(aggregateDays: number): Promise<number> {
  const rows = (await sql`
    WITH daily AS (
      SELECT
        (s.created_at AT TIME ZONE 'UTC')::date AS stat_date,
        k.keyword_id,
        COALESCE(
          NULLIF(
            (ARRAY_AGG(NULLIF(k.keyword_ko, '') ORDER BY s.created_at DESC))[1],
            ''
          ),
          (ARRAY_AGG(k.keyword ORDER BY s.created_at DESC))[1]
        ) AS keyword_ko,
        COALESCE(
          NULLIF(
            (ARRAY_AGG(NULLIF(k.keyword_en, '') ORDER BY s.created_at DESC))[1],
            ''
          ),
          (ARRAY_AGG(k.keyword ORDER BY s.created_at DESC))[1]
        ) AS keyword_en,
        (ARRAY_AGG(k.primary_type ORDER BY s.created_at DESC))[1] AS primary_type,
        COUNT(DISTINCT k.snapshot_id)::int AS snapshot_count,
        COUNT(*)::int AS appearance_count,
        MIN(k.rank)::int AS best_rank,
        AVG(k.rank)::float8 AS avg_rank,
        AVG(k.score)::float8 AS avg_score,
        MAX(s.updated_at_utc) AS last_seen_at_utc
      FROM keywords k
      JOIN snapshots s ON s.snapshot_id = k.snapshot_id
      WHERE s.created_at >= NOW() - (${aggregateDays} * INTERVAL '1 day')
      GROUP BY 1, 2
    )
    INSERT INTO keyword_daily_stats (
      stat_date, keyword_id, keyword_ko, keyword_en, primary_type,
      snapshot_count, appearance_count, best_rank, avg_rank, avg_score,
      last_seen_at_utc, updated_at
    )
    SELECT
      stat_date, keyword_id, keyword_ko, keyword_en, primary_type,
      snapshot_count, appearance_count, best_rank, avg_rank, avg_score,
      last_seen_at_utc, NOW()
    FROM daily
    ON CONFLICT (stat_date, keyword_id) DO UPDATE
    SET keyword_ko = EXCLUDED.keyword_ko,
        keyword_en = EXCLUDED.keyword_en,
        primary_type = EXCLUDED.primary_type,
        snapshot_count = EXCLUDED.snapshot_count,
        appearance_count = EXCLUDED.appearance_count,
        best_rank = EXCLUDED.best_rank,
        avg_rank = EXCLUDED.avg_rank,
        avg_score = EXCLUDED.avg_score,
        last_seen_at_utc = EXCLUDED.last_seen_at_utc,
        updated_at = NOW()
    RETURNING stat_date
  `) as { stat_date: string }[];

  return rows.length;
}

export async function deleteDailyKeywordStatsOlderThan(
  aggregateDays: number
): Promise<number> {
  const rows = (await sql`
    DELETE FROM keyword_daily_stats
    WHERE stat_date < (NOW() - (${aggregateDays} * INTERVAL '1 day'))::date
    RETURNING stat_date
  `) as { stat_date: string }[];

  return rows.length;
}

export async function deleteSourcesOlderThan(
  detailedDays: number
): Promise<number> {
  const rows = (await sql`
    DELETE FROM sources src
    USING snapshots s
    WHERE src.snapshot_id = s.snapshot_id
      AND s.created_at < NOW() - (${detailedDays} * INTERVAL '1 day')
    RETURNING src.id
  `) as { id: number }[];

  return rows.length;
}

export async function deleteKeywordsOlderThan(
  detailedDays: number
): Promise<number> {
  const rows = (await sql`
    DELETE FROM keywords k
    USING snapshots s
    WHERE k.snapshot_id = s.snapshot_id
      AND s.created_at < NOW() - (${detailedDays} * INTERVAL '1 day')
    RETURNING k.keyword_id
  `) as { keyword_id: string }[];

  return rows.length;
}

export async function deleteSnapshotsOlderThan(
  detailedDays: number
): Promise<number> {
  const rows = (await sql`
    DELETE FROM snapshots s
    WHERE s.created_at < NOW() - (${detailedDays} * INTERVAL '1 day')
    RETURNING s.snapshot_id
  `) as { snapshot_id: string }[];

  return rows.length;
}

export async function deleteOrphanKeywordAliases(): Promise<number> {
  const rows = (await sql`
    DELETE FROM keyword_aliases ka
    WHERE NOT EXISTS (
      SELECT 1
      FROM keywords k
      WHERE k.keyword_id = ka.canonical_keyword_id
    )
    RETURNING ka.canonical_keyword_id
  `) as { canonical_keyword_id: string }[];

  return rows.length;
}

export async function deleteKeywordViewCountsOutsideLifecycle(
  lifecycleDays: number,
  topRankLimit = 10
): Promise<number> {
  const rows = (await sql`
    DELETE FROM keyword_view_counts vc
    WHERE NOT EXISTS (
      SELECT 1
      FROM keywords k
      JOIN snapshots s ON s.snapshot_id = k.snapshot_id
      WHERE k.keyword_id = vc.keyword_id
        AND k.rank <= ${topRankLimit}
        AND s.created_at >= NOW() - (${lifecycleDays} * INTERVAL '1 day')
    )
    RETURNING vc.keyword_id
  `) as { keyword_id: string }[];

  return rows.length;
}

export async function applyRetentionPolicy(
  detailedDays: number,
  aggregateDays: number,
  keywordViewLifecycleDays: number
): Promise<RetentionCounts> {
  const aggregatedRows = await upsertKeywordDailyStats(aggregateDays);
  const deletedDailyStats = await deleteDailyKeywordStatsOlderThan(aggregateDays);
  const deletedSources = await deleteSourcesOlderThan(detailedDays);
  const deletedKeywords = await deleteKeywordsOlderThan(detailedDays);
  const deletedSnapshots = await deleteSnapshotsOlderThan(detailedDays);
  const deletedKeywordAliases = await deleteOrphanKeywordAliases();
  const deletedKeywordViewCounts = await deleteKeywordViewCountsOutsideLifecycle(
    keywordViewLifecycleDays
  );

  return {
    aggregatedRows,
    deletedDailyStats,
    deletedSources,
    deletedKeywords,
    deletedSnapshots,
    deletedKeywordAliases,
    deletedKeywordViewCounts,
  };
}

// ─── Search queries ───────────────────────────────────────────────────────────

export async function searchKeywordsByText(
  query: string,
  snapshotId: string,
  limit = 5
): Promise<Keyword[]> {
  const pattern = `%${query}%`;
  return (await sql`
    SELECT DISTINCT k.* FROM keywords k
    LEFT JOIN keyword_aliases ka ON k.keyword_id = ka.canonical_keyword_id
    WHERE k.snapshot_id = ${snapshotId}
      AND (
        k.keyword ILIKE ${pattern}
        OR k.keyword_ko ILIKE ${pattern}
        OR k.keyword_en ILIKE ${pattern}
        OR ka.alias ILIKE ${pattern}
      )
    ORDER BY k.rank ASC
    LIMIT ${limit}
  `) as Keyword[];
}

export async function incrementSearchCount(query: string): Promise<void> {
  const normalized = query.toLowerCase();
  await sql`
    INSERT INTO search_counts (query, count, last_searched_at)
    VALUES (${normalized}, 1, NOW())
    ON CONFLICT (query) DO UPDATE
    SET count = search_counts.count + 1,
        last_searched_at = NOW()
  `;
}

export async function incrementKeywordViewCount(keywordId: string): Promise<void> {
  const normalized = keywordId.trim();
  if (!normalized) return;

  await sql`
    INSERT INTO keyword_view_counts (
      keyword_id,
      view_count,
      last_viewed_at,
      created_at,
      updated_at
    )
    VALUES (${normalized}, 1, NOW(), NOW(), NOW())
    ON CONFLICT (keyword_id) DO UPDATE
    SET view_count = keyword_view_counts.view_count + 1,
        last_viewed_at = NOW(),
        updated_at = NOW()
  `;
}

// ─── Snapshot candidates (ranking simulator) ─────────────────────────────────

export interface SnapshotCandidate {
  snapshot_id: string;
  keyword: string;
  keyword_normalized: string;
  score_recency: number;
  score_frequency: number;
  score_authority: number;
  score_velocity: number;
  score_engagement: number;
  score_internal: number;
  total_score: number;
  source_count: number;
  top_source_title: string | null;
  top_source_domain: string | null;
  is_manual: boolean;
}

export async function insertSnapshotCandidates(
  snapshotId: string,
  candidates: Omit<SnapshotCandidate, "snapshot_id">[]
): Promise<void> {
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map((c) =>
      sql`
        INSERT INTO snapshot_candidates (
          snapshot_id, keyword, keyword_normalized,
          score_recency, score_frequency, score_authority, score_velocity, score_engagement, score_internal,
          total_score, source_count, top_source_title, top_source_domain, is_manual
        ) VALUES (
          ${snapshotId}, ${c.keyword}, ${c.keyword_normalized},
          ${c.score_recency}, ${c.score_frequency}, ${c.score_authority},
          ${c.score_velocity}, ${c.score_engagement}, ${c.score_internal},
          ${c.total_score}, ${c.source_count},
          ${c.top_source_title}, ${c.top_source_domain}, ${c.is_manual}
        )
        ON CONFLICT (snapshot_id, keyword_normalized) DO NOTHING
      `
    )
  );
}

export async function getSnapshotCandidates(
  snapshotId: string
): Promise<SnapshotCandidate[]> {
  return (await sql`
    SELECT * FROM snapshot_candidates
    WHERE snapshot_id = ${snapshotId}
    ORDER BY total_score DESC
  `) as SnapshotCandidate[];
}

// ─── Ranking weights (ranking simulator) ─────────────────────────────────────

export interface RankingWeights {
  w_recency: number;
  w_frequency: number;
  w_authority: number;
  w_velocity: number;
  w_engagement?: number;
  w_internal: number;
  updated_at: string;
}

export async function getRankingWeights(): Promise<RankingWeights> {
  const rows = (await sql`
    SELECT * FROM ranking_weights WHERE id = 1
  `) as RankingWeights[];

  if (rows[0]) return rows[0];

  // 테이블이 비어있으면 기본값 INSERT 후 반환
  await sql`INSERT INTO ranking_weights (id) VALUES (1) ON CONFLICT DO NOTHING`;
  const fallback = (await sql`
    SELECT * FROM ranking_weights WHERE id = 1
  `) as RankingWeights[];
  return fallback[0] ?? {
    w_recency: 0.28,
    w_frequency: 0.12,
    w_authority: 0.08,
    w_velocity: 0.30,
    w_engagement: 0.22,
    w_internal: 0.00,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertRankingWeights(weights: {
  w_recency: number;
  w_frequency: number;
  w_authority: number;
  w_velocity: number;
  w_internal: number;
}): Promise<RankingWeights> {
  const rows = (await sql`
    INSERT INTO ranking_weights (id, w_recency, w_frequency, w_authority, w_velocity, w_internal, updated_at)
    VALUES (1, ${weights.w_recency}, ${weights.w_frequency}, ${weights.w_authority}, ${weights.w_velocity}, ${weights.w_internal}, NOW())
    ON CONFLICT (id) DO UPDATE
    SET w_recency = EXCLUDED.w_recency,
        w_frequency = EXCLUDED.w_frequency,
        w_authority = EXCLUDED.w_authority,
        w_velocity = EXCLUDED.w_velocity,
        w_internal = EXCLUDED.w_internal,
        updated_at = NOW()
    RETURNING *
  `) as RankingWeights[];

  return rows[0];
}
