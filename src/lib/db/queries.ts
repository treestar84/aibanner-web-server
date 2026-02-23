import { sql } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Snapshot {
  snapshot_id: string;
  updated_at_utc: string;
  next_update_at_utc: string;
  created_at: string;
}

export interface Keyword {
  snapshot_id: string;
  keyword_id: string;
  keyword: string;
  rank: number;
  delta_rank: number;
  is_new: boolean;
  score: number;
  score_recency: number;
  score_frequency: number;
  score_authority: number;
  score_internal: number;
  summary_short: string;
  primary_type: "news" | "web" | "video" | "image";
  top_source_title: string | null;
  top_source_url: string | null;
  top_source_domain: string | null;
  top_source_image_url: string | null;
  created_at: string;
}

export interface Source {
  id: number;
  snapshot_id: string;
  keyword_id: string;
  type: "news" | "web" | "video" | "image";
  title: string;
  url: string;
  domain: string;
  published_at_utc: string | null;
  snippet: string | null;
  image_url: string;
  created_at: string;
}

// ─── Snapshot queries ─────────────────────────────────────────────────────────

export async function getLatestSnapshot(): Promise<Snapshot | null> {
  const rows = (await sql`
    SELECT * FROM snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `) as Snapshot[];
  return rows[0] ?? null;
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
    INSERT INTO snapshots (snapshot_id, updated_at_utc, next_update_at_utc)
    VALUES (${snapshot.snapshot_id}, ${snapshot.updated_at_utc}, ${snapshot.next_update_at_utc})
    ON CONFLICT (snapshot_id) DO NOTHING
  `;
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
    ORDER BY s.created_at DESC
    LIMIT 1
  `) as Keyword[];
  return rows[0] ?? null;
}

export async function insertKeyword(keyword: Omit<Keyword, "created_at">): Promise<void> {
  await sql`
    INSERT INTO keywords (
      snapshot_id, keyword_id, keyword, rank, delta_rank, is_new,
      score, score_recency, score_frequency, score_authority, score_internal,
      summary_short, primary_type,
      top_source_title, top_source_url, top_source_domain, top_source_image_url
    ) VALUES (
      ${keyword.snapshot_id}, ${keyword.keyword_id}, ${keyword.keyword},
      ${keyword.rank}, ${keyword.delta_rank}, ${keyword.is_new},
      ${keyword.score}, ${keyword.score_recency}, ${keyword.score_frequency},
      ${keyword.score_authority}, ${keyword.score_internal},
      ${keyword.summary_short}, ${keyword.primary_type},
      ${keyword.top_source_title}, ${keyword.top_source_url},
      ${keyword.top_source_domain}, ${keyword.top_source_image_url}
    )
    ON CONFLICT (snapshot_id, keyword_id) DO NOTHING
  `;
}

export async function getPreviousRanks(
  snapshotId: string,
  keywordIds: string[]
): Promise<Map<string, number>> {
  if (keywordIds.length === 0) return new Map();

  const rows = (await sql`
    SELECT k.keyword_id, k.rank
    FROM keywords k
    JOIN snapshots s ON k.snapshot_id = s.snapshot_id
    WHERE k.keyword_id = ANY(${keywordIds})
      AND s.created_at < (SELECT created_at FROM snapshots WHERE snapshot_id = ${snapshotId})
    ORDER BY s.created_at DESC
  `) as { keyword_id: string; rank: number }[];

  const map = new Map<string, number>();
  for (const row of rows) {
    if (!map.has(row.keyword_id)) {
      map.set(row.keyword_id, row.rank);
    }
  }
  return map;
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
    INSERT INTO sources (snapshot_id, keyword_id, type, title, url, domain, published_at_utc, snippet, image_url)
    VALUES (
      ${source.snapshot_id}, ${source.keyword_id}, ${source.type},
      ${source.title}, ${source.url}, ${source.domain},
      ${source.published_at_utc}, ${source.snippet}, ${source.image_url}
    )
  `;
}
