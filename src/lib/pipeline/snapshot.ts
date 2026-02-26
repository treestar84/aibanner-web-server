import { collectRssItems } from "./rss";
import { collectHnItems } from "./hn_source";
import { collectGdeltItems } from "./gdelt_source";
import { collectGithubItems } from "./github_source";
import { collectGithubMdItems } from "./github_md_source";
import { collectYoutubeItems } from "./youtube_source";
import { collectGithubReleaseItems } from "./github_releases_source";
import { collectChangelogItems } from "./changelog_source";
import { normalizeKeywords } from "./keywords";
import { rankKeywords, calculateDeltaRanks } from "./scoring";
import { collectSources } from "./tavily";
import { generateSummary } from "./summarize";
import { batchExtractOgImages } from "./og-parser";
import {
  insertSnapshot,
  insertKeyword,
  insertSource,
  getPreviousRanks,
  getRecentSnapshots,
  findCachedKeyword,
} from "@/lib/db/queries";

type RankedKeywordWithDelta = ReturnType<typeof calculateDeltaRanks>[number];

// ─── Snapshot ID ──────────────────────────────────────────────────────────────

function buildSnapshotId(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}_KST`;
}

function nextScheduledTime(): Date {
  // 하루 2회: KST 09:00 (UTC 00:00), KST 18:00 (UTC 09:00)
  const scheduleUTC = [0, 9];
  const now = new Date();
  const nowUTCHour = now.getUTCHours();

  const nextUTCHour = scheduleUTC.find((h) => h > nowUTCHour) ?? scheduleUTC[0];
  const addDays = nextUTCHour <= nowUTCHour ? 1 : 0;

  const next = new Date(now);
  next.setUTCHours(nextUTCHour + addDays * 24, 0, 0, 0);
  return next;
}

// ─── Per-keyword processor ────────────────────────────────────────────────────

async function processKeyword(
  item: RankedKeywordWithDelta,
  snapshotId: string,
  recentSnapshotIds: string[],
  defaultImage: string
): Promise<{ reused: boolean }> {
  const kw = item.keyword;

  // ── 캐시 조회 (최근 4 스냅샷) ──────────────────────────────────
  const cached = await findCachedKeyword(kw.keywordId, recentSnapshotIds);

  if (cached) {
    console.log(`[snapshot] [REUSE] ${kw.keyword} (rank ${item.rank})`);
    await insertKeyword({
      snapshot_id: snapshotId,
      keyword_id: kw.keywordId,
      keyword: kw.keyword,
      rank: item.rank,
      delta_rank: item.deltaRank,
      is_new: false,
      score: item.score.total,
      score_recency: item.score.recency,
      score_frequency: item.score.frequency,
      score_authority: item.score.authority,
      score_internal: item.score.internal,
      summary_short: cached.keyword.summary_short,
      primary_type: cached.keyword.primary_type,
      top_source_title: cached.keyword.top_source_title,
      top_source_url: cached.keyword.top_source_url,
      top_source_domain: cached.keyword.top_source_domain,
      top_source_image_url: cached.keyword.top_source_image_url,
    });

    // source insert 병렬화
    await Promise.all(
      cached.sources.map((src) =>
        insertSource({
          snapshot_id: snapshotId,
          keyword_id: src.keyword_id,
          type: src.type,
          title: src.title,
          url: src.url,
          domain: src.domain,
          published_at_utc: src.published_at_utc,
          snippet: src.snippet,
          image_url: src.image_url,
        })
      )
    );
    return { reused: true };
  }

  // ── 신규: Tavily 수집 ────────────────────────────────────────────
  console.log(`[snapshot] [NEW]   ${kw.keyword} (rank ${item.rank})`);
  const sourcesMap = await collectSources(kw.keyword);
  const allSources = [...sourcesMap.news, ...sourcesMap.web];

  const urlsToFetch = allSources.filter((s) => !s.imageUrl).slice(0, 10).map((s) => s.url);
  const ogMap = await batchExtractOgImages(urlsToFetch);
  for (const source of allSources) {
    if (!source.imageUrl && ogMap.has(source.url)) {
      source.imageUrl = ogMap.get(source.url) ?? null;
    }
  }

  const summary = await generateSummary(
    kw.keyword,
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5)
  );
  const topSource = sourcesMap.news[0] ?? allSources[0];

  await insertKeyword({
    snapshot_id: snapshotId,
    keyword_id: kw.keywordId,
    keyword: kw.keyword,
    rank: item.rank,
    delta_rank: item.deltaRank,
    is_new: item.isNew,
    score: item.score.total,
    score_recency: item.score.recency,
    score_frequency: item.score.frequency,
    score_authority: item.score.authority,
    score_internal: item.score.internal,
    summary_short: summary,
    primary_type: topSource?.type ?? "news",
    top_source_title: topSource?.title ?? null,
    top_source_url: topSource?.url ?? null,
    top_source_domain: topSource?.domain ?? null,
    top_source_image_url: topSource?.imageUrl ?? null,
  });

  // source insert 병렬화
  await Promise.all(
    Object.entries(sourcesMap).flatMap(([type, typeItems]) =>
      typeItems.slice(0, 8).map((source) =>
        insertSource({
          snapshot_id: snapshotId,
          keyword_id: kw.keywordId,
          type: type as "news" | "web" | "video" | "image",
          title: source.title,
          url: source.url,
          domain: source.domain,
          published_at_utc: source.publishedAt,
          snippet: source.snippet || null,
          image_url: source.imageUrl ?? defaultImage,
        })
      )
    )
  );

  return { reused: false };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runSnapshotPipeline(): Promise<{
  snapshotId: string;
  keywordCount: number;
  reusedCount: number;
}> {
  console.log("[snapshot] Pipeline started");

  // 최근 4개 스냅샷 조회 (캐시 범위 48h)
  const CACHE_SNAPSHOTS = 4;
  const recentSnapshots = await getRecentSnapshots(CACHE_SNAPSHOTS);
  const prevSnapshot = recentSnapshots[0] ?? null; // delta rank 계산용
  const recentSnapshotIds = recentSnapshots.map((s) => s.snapshot_id);

  // 1) 전체 소스 병렬 수집
  console.log("[snapshot] Step 1: Collecting items from all sources...");
  const [rssItems, hnItems, gdeltItems, githubItems, githubMdItems, youtubeItems, githubReleaseItems, changelogItems] =
    await Promise.all([
      collectRssItems(),
      collectHnItems(),
      collectGdeltItems(),
      collectGithubItems(),
      collectGithubMdItems(),
      collectYoutubeItems(),
      collectGithubReleaseItems(),
      collectChangelogItems(),
    ]);

  // URL 기준 중복 제거 후 합산 (P0_CURATED 소스 우선)
  const seenUrls = new Set<string>();
  const allItems = [
    ...rssItems,
    ...githubMdItems,
    ...githubReleaseItems,
    ...changelogItems,
    ...youtubeItems,
    ...hnItems,
    ...gdeltItems,
    ...githubItems,
  ].filter((item) => {
    if (seenUrls.has(item.link)) return false;
    seenUrls.add(item.link);
    return true;
  });
  console.log(
    `[snapshot] Got ${allItems.length} items (rss=${rssItems.length}, githubMd=${githubMdItems.length}, githubRel=${githubReleaseItems.length}, changelog=${changelogItems.length}, youtube=${youtubeItems.length}, hn=${hnItems.length}, gdelt=${gdeltItems.length}, github=${githubItems.length})`
  );

  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const normalizedKeywords = await normalizeKeywords(allItems);
  console.log(`[snapshot] Got ${normalizedKeywords.length} normalized keywords`);

  // 4~6) 스코어링 + Top 20 선별
  console.log("[snapshot] Step 4-6: Scoring and ranking...");
  const ranked = rankKeywords(normalizedKeywords, 20);

  // 이전 스냅샷 rank 조회
  const snapshotId = buildSnapshotId();
  const prevRankMap = await getPreviousRanks(
    snapshotId,
    ranked.map((r) => r.keyword.keywordId)
  );
  const rankedWithDelta = calculateDeltaRanks(ranked, prevRankMap);

  // Novelty 보너스: 새로 등장한 키워드에 +0.15 적용
  const NOVELTY_BONUS = 0.15;
  const finalRanked = rankedWithDelta
    .map((item) =>
      item.isNew
        ? { ...item, score: { ...item.score, total: item.score.total + NOVELTY_BONUS } }
        : item
    )
    .sort((a, b) => b.score.total - a.score.total)
    .map((item, idx) => ({ ...item, rank: idx + 1 }))
    .slice(0, 10);

  // 7) 스냅샷 저장
  console.log("[snapshot] Step 7: Saving snapshot...");
  const now = new Date();
  await insertSnapshot({
    snapshot_id: snapshotId,
    updated_at_utc: now.toISOString(),
    next_update_at_utc: nextScheduledTime().toISOString(),
  });

  // 8) 각 키워드별 처리 — 병렬 실행
  console.log("[snapshot] Step 8: Processing keywords in parallel...");
  const DEFAULT_IMAGE = "/images/default-thumbnail.png";
  const kwResults = await Promise.allSettled(
    finalRanked.map((item) =>
      processKeyword(item, snapshotId, recentSnapshotIds, DEFAULT_IMAGE)
    )
  );

  let keywordCount = 0;
  let reusedCount = 0;
  for (const r of kwResults) {
    if (r.status === "fulfilled") {
      keywordCount++;
      if (r.value.reused) reusedCount++;
    } else {
      console.error("[snapshot] Keyword processing failed:", r.reason);
    }
  }

  console.log(
    `[snapshot] Pipeline complete: snapshotId=${snapshotId}, keywords=${keywordCount} (reused=${reusedCount}, new=${keywordCount - reusedCount})`
  );
  return { snapshotId, keywordCount, reusedCount };
}
