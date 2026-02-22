import { collectRssItems } from "./rss";
import { normalizeKeywords } from "./keywords";
import { rankKeywords, calculateDeltaRanks } from "./scoring";
import { collectSources } from "./tavily";
import { generateSummary } from "./summarize";
import { batchExtractOgImages } from "./og-parser";
import {
  insertSnapshot,
  insertKeyword,
  insertSource,
  getLatestSnapshot,
  getPreviousRanks,
} from "@/lib/db/queries";
import { invalidateApiCache } from "@/lib/kv/cache";

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
  const scheduleHoursKST = [0, 3, 9, 12]; // UTC = KST-9: 09/12/18/21 KST
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;

  const nextKstHour = scheduleHoursKST.find((h) => h > kstHour) ?? scheduleHoursKST[0];
  const addDays = nextKstHour <= kstHour ? 1 : 0;

  const next = new Date(now);
  next.setUTCHours(nextKstHour - 9 + addDays * 24, 0, 0, 0);
  return next;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runSnapshotPipeline(): Promise<{
  snapshotId: string;
  keywordCount: number;
}> {
  console.log("[snapshot] Pipeline started");

  // 1) RSS 수집
  console.log("[snapshot] Step 1: Collecting RSS items...");
  const rssItems = await collectRssItems();
  console.log(`[snapshot] Got ${rssItems.length} RSS items`);

  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const normalizedKeywords = await normalizeKeywords(rssItems);
  console.log(`[snapshot] Got ${normalizedKeywords.length} normalized keywords`);

  // 4~6) 스코어링 + Top10 선정
  console.log("[snapshot] Step 4-6: Scoring and ranking...");
  const ranked = rankKeywords(normalizedKeywords, 10);

  // 이전 스냅샷 rank 조회
  const snapshotId = buildSnapshotId();
  const prevRankMap = await getPreviousRanks(
    snapshotId,
    ranked.map((r) => r.keyword.keywordId)
  );
  const rankedWithDelta = calculateDeltaRanks(ranked, prevRankMap);

  // 7) 스냅샷 저장
  console.log("[snapshot] Step 7: Saving snapshot...");
  const now = new Date();
  await insertSnapshot({
    snapshot_id: snapshotId,
    updated_at_utc: now.toISOString(),
    next_update_at_utc: nextScheduledTime().toISOString(),
  });

  // 8) 각 키워드별 Tavily + 요약 + OG 이미지 + 저장
  let keywordCount = 0;
  for (const item of rankedWithDelta) {
    const kw = item.keyword;
    console.log(`[snapshot] Processing keyword: ${kw.keyword} (rank ${item.rank})`);

    try {
      // Tavily 검색
      const sourcesMap = await collectSources(kw.keyword);
      const allSources = [
        ...sourcesMap.news,
        ...sourcesMap.web,
        ...sourcesMap.video,
        ...sourcesMap.image,
      ];

      // OG 이미지 추출 (상위 N개만)
      const urlsToFetch = allSources
        .filter((s) => s.type !== "image" && !s.imageUrl)
        .slice(0, 15)
        .map((s) => s.url);
      const ogMap = await batchExtractOgImages(urlsToFetch);

      // 이미지 URL 채우기
      for (const source of allSources) {
        if (!source.imageUrl && ogMap.has(source.url)) {
          source.imageUrl = ogMap.get(source.url) ?? null;
        }
      }

      // 요약 생성
      const summary = await generateSummary(
        kw.keyword,
        sourcesMap.news.length > 0 ? sourcesMap.news : allSources.slice(0, 5)
      );

      // Top source (news 우선)
      const topSource = sourcesMap.news[0] ?? allSources[0];

      // keyword 저장
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

      // sources 저장
      const DEFAULT_IMAGE = "/images/default-thumbnail.png";
      for (const [type, typeItems] of Object.entries(sourcesMap)) {
        for (const source of typeItems.slice(0, 8)) {
          await insertSource({
            snapshot_id: snapshotId,
            keyword_id: kw.keywordId,
            type: type as "news" | "web" | "video" | "image",
            title: source.title,
            url: source.url,
            domain: source.domain,
            published_at_utc: source.publishedAt,
            snippet: source.snippet || null,
            image_url: source.imageUrl ?? DEFAULT_IMAGE,
          });
        }
      }

      keywordCount++;
    } catch (err) {
      console.error(`[snapshot] Error processing ${kw.keyword}:`, err);
    }
  }

  // 9) API 캐시 무효화
  await invalidateApiCache();

  console.log(
    `[snapshot] Pipeline complete: snapshotId=${snapshotId}, keywords=${keywordCount}`
  );
  return { snapshotId, keywordCount };
}
