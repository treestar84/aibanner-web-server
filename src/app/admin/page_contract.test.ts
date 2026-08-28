import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("admin youtube tab renders manual links and source channel panels", () => {
  assert.match(pageSource, /import \{ ManualYoutubeLinksPanel \}/);
  assert.match(pageSource, /<ManualYoutubeLinksPanel \/>/);
  assert.match(pageSource, /<YoutubeSourceChannelsPanel \/>/);
});

test("admin page renders the expert-picks panel on its tab", () => {
  assert.match(pageSource, /import \{ ExpertPicksPanel \}/);
  assert.match(pageSource, /<ExpertPicksPanel \/>/);
});

test("admin page renders the community moderation queue on its own tab", () => {
  assert.match(pageSource, /import \{ CommunityPostsPanel \}/);
  assert.match(pageSource, /activeTab === "communityPosts" && <CommunityPostsPanel \/>/);
});

test("the community moderation tab is actually listed in the nav, not just importable", () => {
  const navSource = readFileSync(new URL("./admin-nav.tsx", import.meta.url), "utf8");
  assert.match(navSource, /"communityPosts"/);
  assert.match(navSource, /\{ id: "communityPosts", label: "[^"]+" \}/);
});
