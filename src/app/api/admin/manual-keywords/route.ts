import { NextRequest, NextResponse } from "next/server";
import { listManualKeywords, upsertManualKeyword } from "@/lib/db/queries";
import { parseManualKeywordTtlHours } from "@/lib/manual-keywords";
import type { PipelineMode } from "@/lib/pipeline/mode";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";

export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 300;

function parseOptionalModeParam(value: string | null): {
  mode?: PipelineMode;
  error?: string;
} {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return {};
  if (normalized === "realtime" || normalized === "briefing") {
    return { mode: normalized };
  }
  return { error: "mode must be one of: realtime, briefing" };
}

function parseModeFromBody(value: unknown): { mode?: PipelineMode; error?: string } {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  if (value === "realtime" || value === "briefing") {
    return { mode: value };
  }
  return { error: "mode must be one of: realtime, briefing" };
}

export async function GET(req: NextRequest) {
  try {
    const modeResult = parseOptionalModeParam(req.nextUrl.searchParams.get("mode"));
    if (modeResult.error) {
      return NextResponse.json({ error: modeResult.error }, { status: 400 });
    }

    const items = await listManualKeywords(modeResult.mode);
    return NextResponse.json({
      items,
      count: items.length,
    });
  } catch (err) {
    console.error("[/api/admin/manual-keywords][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          keyword?: unknown;
          mode?: unknown;
          ttlHours?: unknown;
        }
      | null;

    const keyword = typeof body?.keyword === "string" ? body.keyword : "";
    if (!keyword.trim()) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const modeResult = parseModeFromBody(body?.mode);
    if (modeResult.error) {
      return NextResponse.json({ error: modeResult.error }, { status: 400 });
    }

    const ttlResult = parseManualKeywordTtlHours(body?.ttlHours);
    if (ttlResult.error) {
      return NextResponse.json({ error: ttlResult.error }, { status: 400 });
    }

    const item = await upsertManualKeyword({
      keyword,
      mode: modeResult.mode ?? "realtime",
      ttlHours: ttlResult.ttlHours,
    });

    let onDemandSnapshot:
      | {
          ok: true;
          mode: PipelineMode;
          snapshotId: string;
          keywordCount: number;
          reusedCount: number;
        }
      | {
          ok: false;
          mode: PipelineMode;
          error: string;
        };

    try {
      const snapshotResult = await runSnapshotPipeline({ mode: item.mode });
      onDemandSnapshot = {
        ok: true,
        mode: snapshotResult.mode,
        snapshotId: snapshotResult.snapshotId,
        keywordCount: snapshotResult.keywordCount,
        reusedCount: snapshotResult.reusedCount,
      };
    } catch (snapshotErr) {
      onDemandSnapshot = {
        ok: false,
        mode: item.mode,
        error:
          snapshotErr instanceof Error
            ? snapshotErr.message
            : "on-demand snapshot failed",
      };
    }

    return NextResponse.json({ ok: true, item, onDemandSnapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("required") ? 400 : 500;
    if (status === 500) {
      console.error("[/api/admin/manual-keywords][POST]", err);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
