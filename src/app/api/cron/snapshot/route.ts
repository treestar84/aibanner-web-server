import { NextRequest, NextResponse } from "next/server";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";
import { parsePipelineMode } from "@/lib/pipeline/mode";
import {
  runRetentionPolicy,
  type RetentionRunResult,
} from "@/lib/pipeline/retention";
import { collectAndStoreYoutubeRecommendations, cleanOldYoutubeVideos } from "@/lib/pipeline/youtube_recommend_source";
import {
  runTierDemotionBatch,
  runPostSurvivalPointsBatch,
} from "@/lib/pipeline/tier-demotion";
import { pruneTelemetry } from "@/lib/db/telemetry";

export const runtime = "nodejs";
export const maxDuration = 300; // Hobby 플랜 함수 허용치 내에서 여유 확보

export async function GET(req: NextRequest) {
  // Vercel Cron 인증 헤더 또는 CRON_SECRET 검증
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = parsePipelineMode(req.nextUrl.searchParams.get("mode"));
  const runRetention = req.nextUrl.searchParams.get("retention") === "1";
  const startedAt = Date.now();

  // YouTube recommend collection (independent of snapshot pipeline)
  let youtubeResult: { inserted: number; skipped: number } | null = null;
  let youtubeError: string | null = null;
  try {
    youtubeResult = await collectAndStoreYoutubeRecommendations();
    await cleanOldYoutubeVideos();
  } catch (ytErr) {
    youtubeError = String(ytErr);
    console.error("[cron/youtube]", ytErr);
  }

  // 커뮤니티 게시판 주기 배치.
  // - post_survival: 매 크론 실행마다 돈다. 글은 24시간이 지나는 시점이 제각각이라
  //   하루 1회만 돌리면 포인트 지급이 최대 하루 늦어진다. expert_picks의
  //   point_awarded_survival 플래그로 멱등하므로 자주 돌아도 중복 지급은 없다.
  // - tier_demotion: 30일 무활동 + 14일 경과라는 느린 규칙이라 retention과
  //   같은 하루 1회(UTC 00:10) 패스에서만 돈다.
  // 두 배치 모두 스냅샷 파이프라인과 독립적이므로 실패해도 크론 전체를 죽이지
  // 않고 에러만 응답에 실어 보낸다(youtube 스텝과 같은 방식).
  let postSurvivalCount: number | null = null;
  let postSurvivalError: string | null = null;
  try {
    postSurvivalCount = await runPostSurvivalPointsBatch();
  } catch (batchErr) {
    postSurvivalError = String(batchErr);
    console.error("[cron/post-survival-points]", batchErr);
  }

  let tierDemotionCount: number | null = null;
  let tierDemotionError: string | null = null;
  if (runRetention) {
    try {
      tierDemotionCount = await runTierDemotionBatch();
    } catch (batchErr) {
      tierDemotionError = String(batchErr);
      console.error("[cron/tier-demotion]", batchErr);
    }
  }

  try {
    const result = await runSnapshotPipeline({ mode });

    let retention: RetentionRunResult | null = null;
    let retentionError: string | null = null;

    if (runRetention) {
      try {
        retention = await runRetentionPolicy();
      } catch (retentionErr) {
        retentionError = String(retentionErr);
        console.error("[cron/retention]", retentionErr);
      }
      try {
        await pruneTelemetry();
      } catch (pruneErr) {
        console.error("[cron/telemetry-prune]", pruneErr);
      }
    }

    const durationMs = Date.now() - startedAt;
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      snapshotId: result.snapshotId,
      keywordCount: result.keywordCount,
      reusedCount: result.reusedCount,
      newCount: result.keywordCount - result.reusedCount,
      retentionExecuted: runRetention,
      retention,
      retentionError,
      youtube: youtubeResult,
      youtubeError,
      postSurvivalCount,
      postSurvivalError,
      tierDemotionCount,
      tierDemotionError,
      durationMs,
    });
  } catch (err) {
    console.error("[cron/snapshot]", err);
    return NextResponse.json(
      { error: "Pipeline failed", detail: String(err), youtube: youtubeResult, youtubeError },
      { status: 500 }
    );
  }
}

// Vercel Cron은 POST도 지원
export { GET as POST };
