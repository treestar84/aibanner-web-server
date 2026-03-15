-- AI Trend Widget — DB Schema v1
-- Vercel Postgres (PostgreSQL)

-- ============================================================
-- snapshots: 배치 실행 단위. append-only
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id        TEXT        PRIMARY KEY,               -- e.g. "20260222_0900_KST"
  pipeline_mode      TEXT        NOT NULL DEFAULT 'briefing', -- realtime|briefing
  updated_at_utc     TIMESTAMPTZ NOT NULL,
  next_update_at_utc TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- keywords: 스냅샷 scoped 키워드 랭킹
-- ============================================================
CREATE TABLE IF NOT EXISTS keywords (
  snapshot_id         TEXT        NOT NULL REFERENCES snapshots(snapshot_id),
  keyword_id          TEXT        NOT NULL,  -- 서버 발급 고정 ID (canonical)
  keyword             TEXT        NOT NULL,  -- 표시용 문자열
  keyword_ko          TEXT        NOT NULL DEFAULT '', -- 한국어 표시용 키워드
  keyword_en          TEXT        NOT NULL DEFAULT '', -- 영어 표시용 키워드
  rank                INTEGER     NOT NULL,
  delta_rank          INTEGER     NOT NULL DEFAULT 0,
  is_new              BOOLEAN     NOT NULL DEFAULT FALSE,
  score               FLOAT       NOT NULL DEFAULT 0,
  score_recency       FLOAT       NOT NULL DEFAULT 0,
  score_frequency     FLOAT       NOT NULL DEFAULT 0,
  score_authority     FLOAT       NOT NULL DEFAULT 0,
  score_velocity      FLOAT       NOT NULL DEFAULT 0,
  score_internal      FLOAT       NOT NULL DEFAULT 0,
  summary_short       TEXT        NOT NULL DEFAULT '',     -- <=440자(기본), 이모지/불릿 금지 (한국어)
  summary_short_en    TEXT        NOT NULL DEFAULT '',     -- <=440자(기본), 이모지/불릿 금지 (영어)
  primary_type        TEXT        NOT NULL DEFAULT 'news', -- news|social|data (legacy: web|video|image)
  top_source_title    TEXT,
  top_source_title_ko TEXT,
  top_source_title_en TEXT,
  top_source_url      TEXT,
  top_source_domain   TEXT,
  top_source_image_url TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_keywords_snapshot_rank
  ON keywords(snapshot_id, rank);

-- ============================================================
-- keyword_aliases: 정규화 결과 (aliases → canonical)
-- ============================================================
CREATE TABLE IF NOT EXISTS keyword_aliases (
  canonical_keyword_id TEXT        NOT NULL,
  alias                TEXT        NOT NULL,
  lang                 TEXT        NOT NULL DEFAULT 'ko',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (canonical_keyword_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_aliases_alias
  ON keyword_aliases(alias);

-- ============================================================
-- sources: 스냅샷+키워드 scoped 출처 카드
-- ============================================================
CREATE TABLE IF NOT EXISTS sources (
  id               SERIAL,
  snapshot_id      TEXT        NOT NULL,
  keyword_id       TEXT        NOT NULL,
  type             TEXT        NOT NULL,   -- news|social|data (legacy: web|video|image)
  title            TEXT        NOT NULL,
  url              TEXT        NOT NULL,
  domain           TEXT        NOT NULL,
  published_at_utc TIMESTAMPTZ,
  snippet          TEXT,
  image_url        TEXT        NOT NULL,   -- 항상 존재 (default fallback)
  title_ko         TEXT,                   -- 한국어 번역 제목
  title_en         TEXT,                   -- 영어 번역 제목
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sources_snapshot_keyword_type
  ON sources(snapshot_id, keyword_id, type);

CREATE INDEX IF NOT EXISTS idx_sources_snapshot_keyword
  ON sources(snapshot_id, keyword_id);

-- 중복 정리: 동일 소스를 여러 번 insert한 과거 데이터 정리
WITH dedup AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY snapshot_id, keyword_id, type, url
      ORDER BY id ASC
    ) AS rn
  FROM sources
)
DELETE FROM sources
WHERE id IN (SELECT id FROM dedup WHERE rn > 1);

-- 재시도/중복 실행 시 동일 source 레코드 중복 삽입 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_unique_row
  ON sources(snapshot_id, keyword_id, type, url);

-- ============================================================
-- keyword_daily_stats: 장기 보관(집계) 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS keyword_daily_stats (
  stat_date         DATE             NOT NULL,
  keyword_id        TEXT             NOT NULL,
  keyword_ko        TEXT             NOT NULL,
  keyword_en        TEXT             NOT NULL,
  primary_type      TEXT             NOT NULL,
  snapshot_count    INTEGER          NOT NULL DEFAULT 0,
  appearance_count  INTEGER          NOT NULL DEFAULT 0,
  best_rank         INTEGER          NOT NULL DEFAULT 9999,
  avg_rank          DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_score         DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_seen_at_utc  TIMESTAMPTZ      NOT NULL,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stat_date, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_keyword_daily_stats_keyword_date
  ON keyword_daily_stats(keyword_id, stat_date DESC);

-- ============================================================
-- Backfill / additive columns for existing databases
-- ============================================================
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS pipeline_mode TEXT NOT NULL DEFAULT 'briefing';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS keyword_ko TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS keyword_en TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS summary_short_en TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS top_source_title_ko TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS top_source_title_en TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS score_velocity FLOAT NOT NULL DEFAULT 0;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS title_ko TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS title_en TEXT;

UPDATE keywords
SET keyword_ko = keyword
WHERE COALESCE(keyword_ko, '') = '';

UPDATE keywords
SET keyword_en = keyword
WHERE COALESCE(keyword_en, '') = '';

-- ============================================================
-- search_counts: 검색 쿼리별 누적 카운트
-- ============================================================
CREATE TABLE IF NOT EXISTS search_counts (
  query             TEXT        PRIMARY KEY,
  count             INTEGER     NOT NULL DEFAULT 1,
  last_searched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- keyword_view_counts: 키워드별 사용자 조회 누적
-- 3일 생존 주기 기반 정리 대상 (retention 파이프라인에서 prune)
-- ============================================================
CREATE TABLE IF NOT EXISTS keyword_view_counts (
  keyword_id       TEXT        PRIMARY KEY,
  view_count       BIGINT      NOT NULL DEFAULT 0,
  last_viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_view_counts_view_count
  ON keyword_view_counts(view_count DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_view_counts_last_viewed_at
  ON keyword_view_counts(last_viewed_at DESC);

-- ============================================================
-- manual_keywords: 관리자 수동 키워드 강제 노출
-- ============================================================
CREATE TABLE IF NOT EXISTS manual_keywords (
  id           SERIAL      PRIMARY KEY,
  keyword      TEXT        NOT NULL,
  mode         TEXT        NOT NULL DEFAULT 'realtime', -- realtime|briefing
  ttl_hours    INTEGER     NOT NULL DEFAULT 6,
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_keywords_active
  ON manual_keywords(mode, enabled, expires_at DESC);

WITH ranked_manual_keywords AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY mode, lower(keyword)
      ORDER BY
        CASE
          WHEN enabled = TRUE
            AND starts_at <= NOW()
            AND expires_at > NOW() THEN 0
          WHEN enabled = TRUE THEN 1
          ELSE 2
        END,
        expires_at DESC,
        updated_at DESC,
        id DESC
    ) AS row_num
  FROM manual_keywords
)
DELETE FROM manual_keywords mk
USING ranked_manual_keywords ranked
WHERE mk.id = ranked.id
  AND ranked.row_num > 1;

DROP INDEX IF EXISTS idx_manual_keywords_mode_keyword_lower;

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_keywords_mode_keyword_lower
  ON manual_keywords(mode, lower(keyword));

-- ============================================================
-- source_ingestion_state: 소스별 증분 수집 상태 저장
-- ============================================================
CREATE TABLE IF NOT EXISTS source_ingestion_state (
  source_key            TEXT        PRIMARY KEY,
  last_success_at_utc   TIMESTAMPTZ,
  last_published_at_utc TIMESTAMPTZ,
  last_item_count       INTEGER     NOT NULL DEFAULT 0,
  last_window_hours     INTEGER     NOT NULL DEFAULT 72,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
