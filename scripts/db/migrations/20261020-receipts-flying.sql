-- 2026-10-20 영수증·flying 추가 테이블. 기존 테이블은 건드리지 않는 additive 마이그레이션.
CREATE TABLE IF NOT EXISTS receipts (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  device_id   TEXT NOT NULL REFERENCES device_principals(device_id),
  body        TEXT NOT NULL,
  item_count  SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_device_created ON receipts(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS receipt_opens (
  receipt_id    BIGINT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  visitor_hash  TEXT NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (receipt_id, visitor_hash)
);

CREATE TABLE IF NOT EXISTS flying_shares (
  device_id    TEXT NOT NULL REFERENCES device_principals(device_id),
  content_key  TEXT NOT NULL,
  channel      TEXT NOT NULL,
  day_bucket   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, content_key, day_bucket)
);
CREATE INDEX IF NOT EXISTS idx_flying_shares_device_day ON flying_shares(device_id, day_bucket);

-- 2026-10-20 영수증에 담긴 글의 키(발행 순서). 공개 페이지가 삭제·숨김된
-- 커뮤니티 글을 가리는 데 쓴다.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS content_keys TEXT[] NOT NULL DEFAULT '{}';
