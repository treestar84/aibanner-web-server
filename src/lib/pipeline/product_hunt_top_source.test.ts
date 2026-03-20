import test from "node:test";
import assert from "node:assert/strict";

import type { ProductHuntPost } from "@/lib/pipeline/product_hunt_top_source";
import {
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
