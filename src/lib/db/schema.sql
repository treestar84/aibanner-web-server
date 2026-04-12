-- AI Trend Widget — DB Schema v1
-- Vercel Postgres (PostgreSQL)

-- ============================================================
-- snapshots: 배치 실행 단위. append-only
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id        TEXT        PRIMARY KEY,               -- e.g. "20260222_0900_KST"
  pipeline_mode      TEXT        NOT NULL DEFAULT 'realtime',
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
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS pipeline_mode TEXT NOT NULL DEFAULT 'realtime';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS keyword_ko TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS keyword_en TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS summary_short_en TEXT NOT NULL DEFAULT '';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS bullets_ko TEXT NOT NULL DEFAULT '[]';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS bullets_en TEXT NOT NULL DEFAULT '[]';
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS top_source_title_ko TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS top_source_title_en TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS score_velocity FLOAT NOT NULL DEFAULT 0;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS score_engagement FLOAT NOT NULL DEFAULT 0;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS score_engagement REAL DEFAULT 0;
ALTER TABLE ranking_weights ADD COLUMN IF NOT EXISTS w_engagement REAL NOT NULL DEFAULT 0.22;

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
  mode         TEXT        NOT NULL DEFAULT 'realtime',
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
-- manual_youtube_links: 관리자 수동 유튜브 링크 큐레이션
-- ============================================================
CREATE TABLE IF NOT EXISTS manual_youtube_links (
  id            SERIAL      PRIMARY KEY,
  video_id      TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  channel_name  TEXT        NOT NULL DEFAULT '',
  video_url     TEXT        NOT NULL,
  thumbnail_url TEXT        NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_youtube_links_video_id
  ON manual_youtube_links(video_id);

CREATE INDEX IF NOT EXISTS idx_manual_youtube_links_updated_at
  ON manual_youtube_links(updated_at DESC, id DESC);

-- ============================================================
-- youtube_recommend_channels: 유튜브 추천 수집 채널 목록
-- ============================================================
CREATE TABLE IF NOT EXISTS youtube_recommend_channels (
  id             SERIAL      PRIMARY KEY,
  channel_id     TEXT        NOT NULL,
  channel_name   TEXT        NOT NULL,
  channel_handle TEXT        NOT NULL DEFAULT '',
  channel_url    TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_youtube_recommend_channels_channel_id
  ON youtube_recommend_channels(channel_id);

CREATE INDEX IF NOT EXISTS idx_youtube_recommend_channels_updated_at
  ON youtube_recommend_channels(updated_at DESC, id DESC);

INSERT INTO youtube_recommend_channels (channel_id, channel_name, channel_handle, channel_url)
VALUES
  ('UCQNE2JmbasNYbjGAcuBiRRg', '조코딩 JoCoding', '@JoCoding', 'https://www.youtube.com/@JoCoding'),
  ('UCxj3eVTAv9KLdrowXcuCFDQ', '빌더 조쉬 Builder Josh', '@builderJosh', 'https://www.youtube.com/@builderJosh'),
  ('UCxZ2AlaT0hOmxzZVbF_j_Sw', '코드팩토리', '@codefactory', 'https://www.youtube.com/@codefactory'),
  ('UC6xro-nRXlpa4A5UoeFKUDA', '커서맛피아', '@cursormafia', 'https://www.youtube.com/@cursormafia'),
  ('UCztt42h03X49HFRGW9--Bhg', 'AI 보좌관', '@aiadjunct', 'https://www.youtube.com/@aiadjunct'),
  ('UCLR3sD0KB_dWpvcsrLP0aUg', '오늘코드', '@todaycode', 'https://www.youtube.com/@todaycode'),
  ('UCGU_CgteEqNSjiXcF0QfaKg', '데이터팝콘', '@data.popcorn', 'https://www.youtube.com/@data.popcorn'),
  ('UCifUR1eEHhhXxK_Q_XoArPQ', '큐제이씨', '@qjc_qjc', 'https://www.youtube.com/@qjc_qjc'),
  ('UC86HxrAQ4GS1Iq8LIvUYigQ', '소스놀이터', '@sourcePlayground', 'https://www.youtube.com/@sourcePlayground'),
  ('UCZ4mb62ECiTMw8DcbBcMLmA', '엔드플랜', '@ENDPLAN', 'https://www.youtube.com/@ENDPLAN'),
  ('UCA6KbBMswPWk6sMTVxDa5xg', '텐빌더', '@ten-builder', 'https://www.youtube.com/@ten-builder'),
  ('UC6VbqOLKkdDhdtnhuTYPKxA', 'SV 개발자', '@sv.developer', 'https://www.youtube.com/@sv.developer'),
  ('UCZ30aWiMw5C8mGcESlAGQbA', '짐코딩', '@gymcoding', 'https://www.youtube.com/@gymcoding'),
  ('UCeN2YeJcBCRJoXgzF_OU3qw', '언리얼테크', '@unrealtech', 'https://www.youtube.com/@unrealtech'),
  ('UCFmYIak2sRBXt2M3ep6U3QA', '제이초이', '@jayychoii', 'https://www.youtube.com/@jayychoii'),
  ('UC0WxGJnTB_04ViIrxPvFRmg', '메이커에반', '@maker-evan', 'https://www.youtube.com/@maker-evan'),
  ('UC1_ZZYZsHh2_DzCXN4VGVcQ', '개발동생', '@개발동생', 'https://www.youtube.com/@개발동생'),
  ('UCqeurGTkc3KXeEcBO4S_Jyw', '코난쌤 conanssam', '@conanssam', 'https://www.youtube.com/@conanssam'),
  ('UCSHbj8-YcdasMzqRzn_mHGA', '아이티커넥트', '@itconnect_dev', 'https://www.youtube.com/@itconnect_dev'),
  ('UCScI4bsr-RaGdYSC2QAHWug', '하울 바이브 코딩', '@howl_vibe', 'https://www.youtube.com/@howl_vibe'),
  ('UCDLlMjELbrJdETmSiAB68AA', '시민개발자 구씨', '@citizendev9c', 'https://www.youtube.com/@citizendev9c'),
  ('UCSOYuo3uOG3GCUFIeB4or7A', 'AISchool', '@aischool_ai', 'https://www.youtube.com/@aischool_ai'),
  ('UCqJNohiUt7qgGpKQh0O5yrQ', '잇다방 ITdabang', '@itdabang', 'https://www.youtube.com/@itdabang'),
  ('UCouEEn-xhyTN9K6wSXjBbVQ', 'AI싱크클럽', '@AISyncClub', 'https://www.youtube.com/@AISyncClub'),
  ('UCfZCgp-n4yLLEaX6E30Xh4w', '대모산 개발단', '@대모산개발단', 'https://www.youtube.com/@대모산개발단'),
  ('UCXKXULkq--aSgzScYeLYJog', '단테랩스', '@dante-labs', 'https://www.youtube.com/@dante-labs')
ON CONFLICT (channel_id) DO NOTHING;

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

-- ============================================================
-- snapshot_candidates: 스코어링 후보 전체 저장 (랭킹 시뮬레이터용)
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshot_candidates (
  snapshot_id        TEXT    NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  keyword            TEXT    NOT NULL,
  keyword_normalized TEXT    NOT NULL,
  score_recency      REAL    DEFAULT 0,
  score_frequency    REAL    DEFAULT 0,
  score_authority    REAL    DEFAULT 0,
  score_velocity     REAL    DEFAULT 0,
  score_engagement   REAL    DEFAULT 0,
  score_internal     REAL    DEFAULT 0,
  total_score        REAL    DEFAULT 0,
  source_count       INTEGER DEFAULT 0,
  top_source_title   TEXT,
  top_source_domain  TEXT,
  is_manual          BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (snapshot_id, keyword_normalized)
);

ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS policy_delta REAL DEFAULT 0;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS stability_delta REAL DEFAULT 0;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS manual_delta REAL DEFAULT 0;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS family_key TEXT;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS family_label TEXT;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS family_source TEXT;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS keyword_kind TEXT;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS version_kind TEXT;
ALTER TABLE snapshot_candidates ADD COLUMN IF NOT EXISTS internal_reason TEXT;

-- ============================================================
-- ranking_weights: 관리자 가중치 설정 (단일 행)
-- ============================================================
CREATE TABLE IF NOT EXISTS ranking_weights (
  id          INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  w_recency   REAL        NOT NULL DEFAULT 0.42,
  w_frequency REAL        NOT NULL DEFAULT 0.16,
  w_authority REAL        NOT NULL DEFAULT 0.10,
  w_velocity  REAL        NOT NULL DEFAULT 0.30,
  w_engagement REAL       NOT NULL DEFAULT 0.22,
  w_internal  REAL        NOT NULL DEFAULT 0.00,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ranking_weights (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- promo_contents: 프로모션 카드 콘텐츠 (관리자 등록)
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_contents (
  id             SERIAL      PRIMARY KEY,
  slug           TEXT        UNIQUE NOT NULL,
  tag            TEXT        NOT NULL DEFAULT 'INFO',
  tag_color      TEXT        NOT NULL DEFAULT '#7C3AED',
  title_ko       TEXT        NOT NULL,
  title_en       TEXT        NOT NULL,
  subtitle_ko    TEXT        NOT NULL DEFAULT '',
  subtitle_en    TEXT        NOT NULL DEFAULT '',
  body_ko        TEXT        NOT NULL DEFAULT '',
  body_en        TEXT        NOT NULL DEFAULT '',
  image_url      TEXT        NOT NULL DEFAULT '',
  gradient_from  TEXT        NOT NULL DEFAULT '#7C3AED',
  gradient_to    TEXT        NOT NULL DEFAULT '#4F46E5',
  icon_name      TEXT        NOT NULL DEFAULT 'info',
  link_url       TEXT        NOT NULL DEFAULT '',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_contents_enabled_sort
  ON promo_contents(enabled, sort_order ASC);
