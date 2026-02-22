import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "@vercel/postgres";

async function migrate() {
  console.log("🔄 Running DB migration...");
  const schemaPath = join(process.cwd(), "src/lib/db/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      await sql.query(stmt);
      console.log(`✅ Executed: ${stmt.slice(0, 60).replace(/\n/g, " ")}...`);
    } catch (err) {
      console.error(`❌ Failed: ${stmt.slice(0, 80)}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("✅ Migration complete.");
  process.exit(0);
}

migrate();
