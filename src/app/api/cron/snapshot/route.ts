import { NextRequest, NextResponse } from "next/server";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";
import { parsePipelineMode } from "@/lib/pipeline/mode";
import {
  runRetentionPolicy,
  type RetentionRunResult,
} from "@/lib/pipeline/retention";

export const runtime = "nodejs";
export const maxDuration = 300; // Hobby 플랜 함수 허용치 내에서 여유 확보

export async function GET(req: NextRequest) {
  // Vercel Cron 인증 헤더 또는 CRON_SECRET 검증
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const expected = `Bearer ${cronSecret}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const mode = parsePipelineMode(req.nextUrl.searchParams.get("mode"));
    const runRetention = req.nextUrl.searchParams.get("retention") === "1";
    const startedAt = Date.now();
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
      durationMs,
    });
  } catch (err) {
    console.error("[cron/snapshot]", err);
    return NextResponse.json(
      { error: "Pipeline failed", detail: String(err) },
      { status: 500 }
    );
  }
}

// Vercel Cron은 POST도 지원
export { GET as POST };
