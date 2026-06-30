import type { RankingQualityClass, RankingQualityFixture } from "@/lib/admin/ranking_quality_fixtures";
export { buildAuditQualityFixtures } from "@/lib/admin/ranking_quality_fixtures";

export interface RankedKeywordRef {
  readonly keyword_normalized: string;
  readonly rank: number;
}

export interface QualityReplaySummary {
  readonly protectedGoodCount: number;
  readonly protectedGoodRetained: number;
  readonly knownNoiseCount: number;
  readonly knownNoiseDemotedOrHidden: number;
  readonly details: readonly QualityReplayDetail[];
}

export interface QualityReplayDetail {
  readonly keyword_normalized: string;
  readonly expected_quality: RankingQualityClass;
  readonly beforeRank: number | null;
  readonly afterRank: number | null;
  readonly retained: boolean;
  readonly demotedOrHidden: boolean;
}

export function summarizeQualityReplay(
  fixtures: readonly RankingQualityFixture[],
  before: readonly RankedKeywordRef[],
  after: readonly RankedKeywordRef[]
): QualityReplaySummary {
  const beforeRanks = buildRankMap(before);
  const afterRanks = buildRankMap(after);
  const details = fixtures.map((fixture) =>
    summarizeFixture(fixture, beforeRanks, afterRanks)
  );

  return {
    protectedGoodCount: countByQuality(details, "protected_good"),
    protectedGoodRetained: details.filter((item) => item.retained).length,
    knownNoiseCount: countByQuality(details, "known_noise"),
    knownNoiseDemotedOrHidden: details.filter((item) => item.demotedOrHidden).length,
    details,
  };
}

function buildRankMap(items: readonly RankedKeywordRef[]): ReadonlyMap<string, number> {
  return new Map(items.map((item) => [item.keyword_normalized, item.rank]));
}

function countByQuality(
  details: readonly QualityReplayDetail[],
  expectedQuality: RankingQualityClass
): number {
  return details.filter((item) => item.expected_quality === expectedQuality).length;
}

function summarizeFixture(
  fixture: RankingQualityFixture,
  beforeRanks: ReadonlyMap<string, number>,
  afterRanks: ReadonlyMap<string, number>
): QualityReplayDetail {
  const beforeRank = beforeRanks.get(fixture.keyword_normalized) ?? null;
  const afterRank = afterRanks.get(fixture.keyword_normalized) ?? null;
  const retained =
    fixture.expected_quality === "protected_good" &&
    beforeRank !== null &&
    afterRank !== null &&
    afterRank <= beforeRank + 2;
  const demotedOrHidden =
    fixture.expected_quality === "known_noise" &&
    beforeRank !== null &&
    (afterRank === null || afterRank > beforeRank);

  return {
    keyword_normalized: fixture.keyword_normalized,
    expected_quality: fixture.expected_quality,
    beforeRank,
    afterRank,
    retained,
    demotedOrHidden,
  };
}
