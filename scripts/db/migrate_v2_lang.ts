import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function migrate() {
  console.log("🔄 Running v2 lang migration...");
  const sql = neon(process.env.DATABASE_URL!);

  const statements = [
    `ALTER TABLE keywords ADD COLUMN IF NOT EXISTS summary_short_en TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS title_ko TEXT`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS title_en TEXT`,
  ];

  for (const stmt of statements) {
    try {
      await sql(stmt);
      console.log(`✅ Executed: ${stmt.slice(0, 80)}...`);
    } catch (err) {
      console.error(`❌ Failed: ${stmt.slice(0, 80)}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("✅ v2 lang migration complete.");
  process.exit(0);
}

migrate();
