import type { RssItem } from "@/lib/pipeline/rss";
import type { RankingHistoryStats } from "@/lib/pipeline/ranking_policy";
import type { RankingQualityCandidate } from "@/lib/pipeline/ranking_quality_policy";
import type { RankedKeywordWithDelta } from "@/lib/pipeline/manual_priority";

export function buildRankingQualityCandidate(
  item: RankedKeywordWithDelta,
  sourceItems: readonly RssItem[],
  history: RankingHistoryStats | undefined,
  isManual: boolean
): RankingQualityCandidate {
  const matchedSources = collectMatchedSources(item, sourceItems);
  return {
    keywordId: item.keyword.keywordId,
    keyword: item.keyword.keyword,
    score: {
      total: item.score.total,
      recency: item.score.recency,
      velocity: item.score.velocity,
      engagement: item.score.engagement,
      authority: item.score.authority,
    },
    sourceTexts: matchedSources.map((source) => `${source.title} ${source.summary}`),
    sourceDomains: matchedSources.map((source) => source.sourceDomain),
    latestSourceAt: item.keyword.candidates.latestAt.toISOString(),
    appearances: history?.appearances ?? 0,
    isManual,
  };
}

function collectMatchedSources(
  item: RankedKeywordWithDelta,
  sourceItems: readonly RssItem[]
): RssItem[] {
  const sources: RssItem[] = [];
  for (const index of item.keyword.candidates.matchedItems) {
    const source = sourceItems[index];
    if (!source) continue;
    sources.push(source);
    if (sources.length >= 5) break;
  }
  return sources;
}
