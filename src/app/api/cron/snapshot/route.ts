import { NextRequest, NextResponse } from "next/server";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 (Vercel Pro 기준)

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
    const result = await runSnapshotPipeline();
    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshotId,
      keywordCount: result.keywordCount,
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
