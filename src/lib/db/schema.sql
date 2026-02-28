-- AI Trend Widget — DB Schema v1
-- Vercel Postgres (PostgreSQL)

-- ============================================================
-- snapshots: 배치 실행 단위. append-only
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id        TEXT        PRIMARY KEY,               -- e.g. "20260222_0900_KST"
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
  rank                INTEGER     NOT NULL,
  delta_rank          INTEGER     NOT NULL DEFAULT 0,
  is_new              BOOLEAN     NOT NULL DEFAULT FALSE,
  score               FLOAT       NOT NULL DEFAULT 0,
  score_recency       FLOAT       NOT NULL DEFAULT 0,
  score_frequency     FLOAT       NOT NULL DEFAULT 0,
  score_authority     FLOAT       NOT NULL DEFAULT 0,
  score_internal      FLOAT       NOT NULL DEFAULT 0,
  summary_short       TEXT        NOT NULL DEFAULT '',     -- <=220자, 이모지/불릿 금지 (한국어)
  summary_short_en    TEXT        NOT NULL DEFAULT '',     -- <=220자, 이모지/불릿 금지 (영어)
  primary_type        TEXT        NOT NULL DEFAULT 'news', -- news|social|data (legacy: web|video|image)
  top_source_title    TEXT,
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
  type             TEXT        NOT NULL,   -- news|web|video|image
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
-- search_counts: 검색 쿼리별 누적 카운트
-- ============================================================
CREATE TABLE IF NOT EXISTS search_counts (
  query             TEXT        PRIMARY KEY,
  count             INTEGER     NOT NULL DEFAULT 1,
  last_searched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
