import test from "node:test";
import assert from "node:assert/strict";

import type { ProductHuntPost } from "@/lib/pipeline/product_hunt_top_source";
import {
  collectProductHuntTopItems,
  getPacificDateKey,
  isCurrentPacificTopLaunch,
  resolveProductHuntRankingSignal,
} from "@/lib/pipeline/product_hunt_top_source";

test("resolveProductHuntRankingSignal gives strongest bonus to top 3 launches", () => {
  assert.deepEqual(resolveProductHuntRankingSignal(1), {
    sourceKey: "product_hunt_top",
    authorityOverride: 0.9,
    domainBonus: 2,
    rank: 1,
  });
});

test("resolveProductHuntRankingSignal gives mid bonus to top 10 launches", () => {
  assert.deepEqual(resolveProductHuntRankingSignal(7), {
    sourceKey: "product_hunt_top",
    authorityOverride: 0.84,
    domainBonus: 1,
    rank: 7,
  });
});

test("resolveProductHuntRankingSignal gives mild bonus to lower ranked featured launches", () => {
  assert.deepEqual(resolveProductHuntRankingSignal(15), {
    sourceKey: "product_hunt_top",
    authorityOverride: 0.72,
    domainBonus: 0.5,
    rank: 15,
  });
});

test("getPacificDateKey tracks Product Hunt featured dates in Pacific time", () => {
  assert.equal(
    getPacificDateKey(new Date("2026-03-20T07:01:00.000Z")),
    "2026-03-20"
  );
});

test("isCurrentPacificTopLaunch requires same Pacific day and a valid daily rank", () => {
  const post: ProductHuntPost = {
    id: "1",
    name: "Composer 2 by Cursor",
    tagline: "AI pair programmer for your codebase",
    url: "https://www.producthunt.com/products/cursor",
    featuredAt: "2026-03-20T07:01:00.000Z",
    createdAt: "2026-03-20T06:55:00.000Z",
    dailyRank: 3,
    votesCount: 231,
  };

  assert.equal(isCurrentPacificTopLaunch(post, "2026-03-20"), true);
  assert.equal(isCurrentPacificTopLaunch(post, "2026-03-21"), false);
});

test("collectProductHuntTopItems maps votesCount into engagement score", async () => {
  const originalToken = process.env.PRODUCT_HUNT_TOKEN;
  const originalFetch = global.fetch;
  process.env.PRODUCT_HUNT_TOKEN = "test-token";

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          posts: {
            nodes: [
              {
                id: "1",
                name: "Google Gemini Memory Import",
                tagline: "Bring your chat history into Gemini",
                url: "https://www.producthunt.com/posts/google-gemini-memory-import",
                website: "https://gemini.google.com",
                featuredAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                dailyRank: 2,
                votesCount: 412,
                topics: {
                  edges: [{ node: { slug: "ai", name: "AI" } }],
                },
              },
            ],
          },
        },
      }),
      { status: 200 }
    );

  try {
    const items = await collectProductHuntTopItems(72);
    assert.equal(items.length, 1);
    assert.equal(items[0].engagement?.score, 412);
    assert.equal(items[0].engagement?.comments, 0);
  } finally {
    process.env.PRODUCT_HUNT_TOKEN = originalToken;
    global.fetch = originalFetch;
  }
});
