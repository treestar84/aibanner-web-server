import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function migrate() {
  console.log("Running v3 youtube migration...");
  const sql = neon(process.env.DATABASE_URL!);

  const statements = [
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
      like_count    INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_youtube_videos_published
      ON youtube_videos (published_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel
      ON youtube_videos (channel_id, published_at DESC)`,
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
