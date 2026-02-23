import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";

async function migrate() {
  console.log("🔄 Running DB migration...");
  const sql = neon(process.env.DATABASE_URL!);

  const schemaPath = join(process.cwd(), "src/lib/db/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const statements = schema
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await sql(stmt);
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
