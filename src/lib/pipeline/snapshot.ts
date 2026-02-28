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
import { generateSummaries, batchTranslateTitles } from "./summarize";
import { batchExtractOgImages } from "./og-parser";
import { determinePrimaryType, pickPrimarySource } from "./source_category";
import {
  insertSnapshot,
  insertKeyword,
  insertSource,
  getPreviousRanks,
  getRecentSnapshots,
  findCachedKeyword,
} from "@/lib/db/queries";

type RankedKeywordWithDelta = ReturnType<typeof calculateDeltaRanks>[number];
const RANKING_CANDIDATE_LIMIT = 20;
const DEFAULT_DETAILED_KEYWORD_LIMIT = 10;

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

const DETAILED_KEYWORD_LIMIT = parsePositiveIntEnv(
  process.env.PIPELINE_DETAILED_KEYWORDS,
  DEFAULT_DETAILED_KEYWORD_LIMIT,
  1,
  RANKING_CANDIDATE_LIMIT
);
const KEYWORD_CONCURRENCY = parsePositiveIntEnv(
  process.env.PIPELINE_KEYWORD_CONCURRENCY,
  3,
  1,
  10
);
const LIGHTWEIGHT_CONCURRENCY = parsePositiveIntEnv(
  process.env.PIPELINE_LIGHTWEIGHT_CONCURRENCY,
  5,
  1,
  20
);
const DEFAULT_SCHEDULE_UTC = "0:17,9:17";

interface ScheduleSlot {
  hour: number;
  minute: number;
}

function parseScheduleUtc(value: string | undefined): ScheduleSlot[] {
  const raw = value?.trim() || DEFAULT_SCHEDULE_UTC;
  const slots = raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [hourText, minuteText = "0"] = chunk.split(":");
      const hour = Number.parseInt(hourText, 10);
      const minute = Number.parseInt(minuteText, 10);
      if (
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        return null;
      }
      return { hour, minute };
    })
    .filter((slot): slot is ScheduleSlot => slot !== null)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  if (slots.length === 0) {
    return parseScheduleUtc(DEFAULT_SCHEDULE_UTC);
  }

  return slots.filter((slot, index) => {
    if (index === 0) return true;
    const prev = slots[index - 1];
    return prev.hour !== slot.hour || prev.minute !== slot.minute;
  });
}

const SCHEDULE_UTC = parseScheduleUtc(process.env.PIPELINE_SCHEDULE_UTC);

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
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const next = new Date(now);

  const sameDaySlot = SCHEDULE_UTC.find(
    (slot) => slot.hour * 60 + slot.minute > nowMinutes
  );
  if (sameDaySlot) {
    next.setUTCHours(sameDaySlot.hour, sameDaySlot.minute, 0, 0);
    return next;
  }

  const first = SCHEDULE_UTC[0];
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(first.hour, first.minute, 0, 0);
  return next;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  const cappedConcurrency = Math.min(concurrency, items.length);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      try {
        const value = await mapper(items[index], index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: cappedConcurrency }, () => worker()));
  return results;
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
    const primaryType = determinePrimaryType(cached.sources);
    const topSource = pickPrimarySource(cached.sources, primaryType);

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
      summary_short_en: cached.keyword.summary_short_en,
      primary_type: primaryType,
      top_source_title: topSource?.title ?? cached.keyword.top_source_title,
      top_source_url: topSource?.url ?? cached.keyword.top_source_url,
      top_source_domain: topSource?.domain ?? cached.keyword.top_source_domain,
      top_source_image_url: topSource?.image_url ?? cached.keyword.top_source_image_url,
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
          title_ko: src.title_ko,
          title_en: src.title_en,
        })
      )
    );
    return { reused: true };
  }

  // ── 신규: Tavily 수집 ────────────────────────────────────────────
  console.log(`[snapshot] [NEW]   ${kw.keyword} (rank ${item.rank})`);
  const sourcesMap = await collectSources(kw.keyword);
  const allSources = [
    ...sourcesMap.news,
    ...sourcesMap.web,
    ...sourcesMap.video,
    ...sourcesMap.image,
  ];

  const urlsToFetch = allSources.filter((s) => !s.imageUrl).slice(0, 10).map((s) => s.url);
  const ogMap = await batchExtractOgImages(urlsToFetch);
  for (const source of allSources) {
    if (!source.imageUrl && ogMap.has(source.url)) {
      source.imageUrl = ogMap.get(source.url) ?? null;
    }
  }

  const summaries = await generateSummaries(
    kw.keyword,
    sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5)
  );
  const primaryType = determinePrimaryType(allSources);
  const topSource = pickPrimarySource(allSources, primaryType);

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
    summary_short: summaries.ko,
    summary_short_en: summaries.en,
    primary_type: primaryType,
    top_source_title: topSource?.title ?? null,
    top_source_url: topSource?.url ?? null,
    top_source_domain: topSource?.domain ?? null,
    top_source_image_url: topSource?.imageUrl ?? null,
  });

  // 소스 제목 번역 (배치)
  const sourceEntries = Object.entries(sourcesMap).flatMap(([type, typeItems]) =>
    typeItems.slice(0, 8).map((source) => ({ type, source }))
  );
  const originalTitles = sourceEntries.map((e) => e.source.title);
  // 영어 제목이면 → 한국어로 번역, 한국어 제목이면 → 영어로 번역
  // 소스 대부분 영어이므로: title_en = 원본, title_ko = 번역
  const translatedKo = await batchTranslateTitles(originalTitles, "ko");

  // source insert 병렬화
  await Promise.all(
    sourceEntries.map(({ type, source }, idx) =>
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
        title_en: source.title,
        title_ko: translatedKo[idx] ?? source.title,
      })
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
  const startedAt = Date.now();
  console.log("[snapshot] Pipeline started");
  console.log(
    `[snapshot] Config: detailedLimit=${DETAILED_KEYWORD_LIMIT}, keywordConcurrency=${KEYWORD_CONCURRENCY}, lightweightConcurrency=${LIGHTWEIGHT_CONCURRENCY}, scheduleUtc=${SCHEDULE_UTC.map((slot) => `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`).join(",")}`
  );

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

  // 4~6) 스코어링 + Top N 선별
  console.log("[snapshot] Step 4-6: Scoring and ranking...");
  const ranked = rankKeywords(normalizedKeywords, RANKING_CANDIDATE_LIMIT);

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
    .slice(0, RANKING_CANDIDATE_LIMIT);

  // 7) 스냅샷 저장
  console.log("[snapshot] Step 7: Saving snapshot...");
  const now = new Date();
  await insertSnapshot({
    snapshot_id: snapshotId,
    updated_at_utc: now.toISOString(),
    next_update_at_utc: nextScheduledTime().toISOString(),
  });

  const detailedRanked = finalRanked.slice(0, DETAILED_KEYWORD_LIMIT);
  const lightweightRanked = finalRanked.slice(DETAILED_KEYWORD_LIMIT);

  // 8) Top 10 상세 키워드 처리 — 병렬 실행
  console.log("[snapshot] Step 8: Processing top 10 keywords in parallel...");
  const DEFAULT_IMAGE = "/images/default-thumbnail.png";
  const kwResults = await mapWithConcurrency(
    detailedRanked,
    KEYWORD_CONCURRENCY,
    (item) => processKeyword(item, snapshotId, recentSnapshotIds, DEFAULT_IMAGE)
  );

  // 9) 11~20 키워드는 검색 화면 노출용으로만 lightweight 저장
  console.log("[snapshot] Step 9: Saving lightweight keywords for search chips...");
  const lightweightResults = await mapWithConcurrency(
    lightweightRanked,
    LIGHTWEIGHT_CONCURRENCY,
    (item) =>
      insertKeyword({
        snapshot_id: snapshotId,
        keyword_id: item.keyword.keywordId,
        keyword: item.keyword.keyword,
        rank: item.rank,
        delta_rank: item.deltaRank,
        is_new: item.isNew,
        score: item.score.total,
        score_recency: item.score.recency,
        score_frequency: item.score.frequency,
        score_authority: item.score.authority,
        score_internal: item.score.internal,
        summary_short: "",
        summary_short_en: "",
        primary_type: "news",
        top_source_title: null,
        top_source_url: null,
        top_source_domain: null,
        top_source_image_url: null,
      })
  );

  let keywordCount = 0;
  let reusedCount = 0;
  let lightweightCount = 0;
  for (const r of kwResults) {
    if (r.status === "fulfilled") {
      keywordCount++;
      if (r.value.reused) reusedCount++;
    } else {
      console.error("[snapshot] Keyword processing failed:", r.reason);
    }
  }
  for (const r of lightweightResults) {
    if (r.status === "fulfilled") {
      lightweightCount++;
    } else {
      console.error("[snapshot] Lightweight keyword save failed:", r.reason);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[snapshot] Pipeline complete: snapshotId=${snapshotId}, keywords=${keywordCount} (reused=${reusedCount}, new=${keywordCount - reusedCount}, lightweight=${lightweightCount}), elapsedMs=${elapsedMs}`
  );
  return { snapshotId, keywordCount, reusedCount };
}
