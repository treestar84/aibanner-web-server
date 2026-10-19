import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
async function migrateReceipts() {
  dotenv.config({ path: ".env.local", quiet: true });
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL or POSTGRES_URL is required");
  const sql = neon(url);
  const script = readFileSync(
    join(
      process.cwd(),
      "scripts/db/migrations/20261020-receipts-flying.sql",
    ),
    "utf8",
  );
  const statements = script
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  await sql.transaction(statements.map((statement) => sql(statement)));
  console.log("Receipts/flying additive migration complete.");
}
migrateReceipts().catch((error) => {
  console.error(
    "Receipts migration failed:",
    error instanceof Error ? error.name : "unknown",
  );
  process.exitCode = 1;
});
