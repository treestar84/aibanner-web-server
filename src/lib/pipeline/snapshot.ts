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
  getKeywordById,
  getSourcesByKeyword,
} from "@/lib/db/queries";

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

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runSnapshotPipeline(): Promise<{
  snapshotId: string;
  keywordCount: number;
  reusedCount: number;
}> {
  console.log("[snapshot] Pipeline started");

  // 이전 스냅샷 확인 (캐시 재사용 기준)
  const prevSnapshot = await getLatestSnapshot();

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

  // 8) 각 키워드별 처리 (신규: Tavily 수집 / 재사용: 이전 스냅샷 복사)
  let keywordCount = 0;
  let reusedCount = 0;
  const DEFAULT_IMAGE = "/images/default-thumbnail.png";

  for (const item of rankedWithDelta) {
    const kw = item.keyword;
    const isReused = prevSnapshot !== null && prevRankMap.has(kw.keywordId);

    console.log(
      `[snapshot] ${isReused ? "[REUSE]" : "[NEW]  "} ${kw.keyword} (rank ${item.rank})`
    );

    try {
      if (isReused && prevSnapshot) {
        // ── 재사용: 이전 스냅샷 소스 복사 ──────────────────────────────────
        const [prevKeyword, prevSources] = await Promise.all([
          getKeywordById(kw.keywordId, prevSnapshot.snapshot_id),
          getSourcesByKeyword(prevSnapshot.snapshot_id, kw.keywordId),
        ]);

        if (!prevKeyword || prevSources.length === 0) {
          // 이전 데이터가 없으면 신규로 처리 (fallthrough)
          console.warn(`[snapshot] Cache miss for ${kw.keyword}, fetching fresh`);
        } else {
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
            // 이전 스냅샷에서 재사용
            summary_short: prevKeyword.summary_short,
            primary_type: prevKeyword.primary_type,
            top_source_title: prevKeyword.top_source_title,
            top_source_url: prevKeyword.top_source_url,
            top_source_domain: prevKeyword.top_source_domain,
            top_source_image_url: prevKeyword.top_source_image_url,
          });

          for (const src of prevSources) {
            await insertSource({
              snapshot_id: snapshotId,
              keyword_id: src.keyword_id,
              type: src.type,
              title: src.title,
              url: src.url,
              domain: src.domain,
              published_at_utc: src.published_at_utc,
              snippet: src.snippet,
              image_url: src.image_url,
            });
          }

          reusedCount++;
          keywordCount++;
          continue;
        }
      }

      // ── 신규: Tavily 수집 (news + web) ─────────────────────────────────────
      const sourcesMap = await collectSources(kw.keyword);
      const allSources = [...sourcesMap.news, ...sourcesMap.web];

      // OG 이미지 추출
      const urlsToFetch = allSources
        .filter((s) => !s.imageUrl)
        .slice(0, 10)
        .map((s) => s.url);
      const ogMap = await batchExtractOgImages(urlsToFetch);

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

  console.log(
    `[snapshot] Pipeline complete: snapshotId=${snapshotId}, keywords=${keywordCount} (reused=${reusedCount}, new=${keywordCount - reusedCount})`
  );
  return { snapshotId, keywordCount, reusedCount };
}
