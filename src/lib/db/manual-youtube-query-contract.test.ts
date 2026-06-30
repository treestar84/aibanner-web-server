import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const queriesSource = readFileSync(
  new URL("./queries.ts", import.meta.url),
  "utf8",
);

test("manual youtube upsert preserves curated video type when incoming type is unknown", () => {
  assert.match(
    queriesSource,
    /WHEN EXCLUDED\.video_type <> 'unknown' THEN EXCLUDED\.video_type/,
    "manual upsert should accept explicit longform/shorts type changes",
  );
  assert.match(
    queriesSource,
    /ELSE manual_youtube_links\.video_type/,
    "manual upsert should keep the current curated type for automatic unknown input",
  );
});
