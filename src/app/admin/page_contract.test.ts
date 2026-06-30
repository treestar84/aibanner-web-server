import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("admin youtube tab renders manual links and source channel panels", () => {
  assert.match(pageSource, /import \{ ManualYoutubeLinksPanel \}/);
  assert.match(pageSource, /<ManualYoutubeLinksPanel \/>/);
  assert.match(pageSource, /<YoutubeSourceChannelsPanel \/>/);
});
