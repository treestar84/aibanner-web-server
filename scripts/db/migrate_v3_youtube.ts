import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function migrate() {
  console.log("Running v3 youtube migration...");
  const sql = neon(process.env.DATABASE_URL!);

  const statements = [
    `ALTER TABLE manual_youtube_links
      ADD COLUMN IF NOT EXISTS video_type TEXT NOT NULL DEFAULT 'unknown'`,
    `UPDATE manual_youtube_links
      SET video_type = 'unknown'
      WHERE video_type NOT IN ('longform', 'shorts', 'unknown')`,
    `ALTER TABLE manual_youtube_links
      DROP CONSTRAINT IF EXISTS chk_manual_youtube_links_video_type`,
    `ALTER TABLE manual_youtube_links
      ADD CONSTRAINT chk_manual_youtube_links_video_type
      CHECK (video_type IN ('longform', 'shorts', 'unknown'))`,
    `CREATE TABLE IF NOT EXISTS youtube_videos (
      id            SERIAL PRIMARY KEY,
      video_id      TEXT NOT NULL UNIQUE,
      channel_id    TEXT NOT NULL,
      channel_name  TEXT NOT NULL,
      title         TEXT NOT NULL,
      thumbnail_url TEXT NOT NULL,
      video_url     TEXT NOT NULL,
      published_at  TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      view_count    INTEGER,
      like_count    INTEGER,
      duration_seconds INTEGER,
      video_type    TEXT NOT NULL DEFAULT 'unknown'
    )`,
    `ALTER TABLE youtube_videos
      ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`,
    `ALTER TABLE youtube_videos
      ADD COLUMN IF NOT EXISTS video_type TEXT NOT NULL DEFAULT 'unknown'`,
    `UPDATE youtube_videos
      SET video_type = 'unknown'
      WHERE video_type NOT IN ('longform', 'shorts', 'unknown')`,
    `UPDATE youtube_videos
      SET duration_seconds = NULL
      WHERE duration_seconds < 0`,
    `ALTER TABLE youtube_videos
      DROP CONSTRAINT IF EXISTS chk_youtube_videos_video_type`,
    `ALTER TABLE youtube_videos
      ADD CONSTRAINT chk_youtube_videos_video_type
      CHECK (video_type IN ('longform', 'shorts', 'unknown'))`,
    `ALTER TABLE youtube_videos
      DROP CONSTRAINT IF EXISTS chk_youtube_videos_duration_seconds`,
    `ALTER TABLE youtube_videos
      ADD CONSTRAINT chk_youtube_videos_duration_seconds
      CHECK (duration_seconds IS NULL OR duration_seconds >= 0)`,
    `CREATE INDEX IF NOT EXISTS idx_youtube_videos_published
      ON youtube_videos (published_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel
      ON youtube_videos (channel_id, published_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_youtube_videos_type_published
      ON youtube_videos (video_type, published_at DESC)`,
  ];

  for (const stmt of statements) {
    try {
      await sql(stmt);
      console.log(`OK: ${stmt.slice(0, 60)}...`);
    } catch (err) {
      console.error(`FAIL: ${stmt.slice(0, 60)}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("v3 youtube migration complete.");
  process.exit(0);
}

migrate();
