import { NextRequest, NextResponse } from "next/server";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";

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
    const startedAt = Date.now();
    const result = await runSnapshotPipeline();
    const durationMs = Date.now() - startedAt;
    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshotId,
      keywordCount: result.keywordCount,
      reusedCount: result.reusedCount,
      newCount: result.keywordCount - result.reusedCount,
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
