import { NextRequest, NextResponse } from "next/server";
import {
  deleteManualKeyword,
  extendManualKeyword,
  getManualKeywordById,
  setManualKeywordEnabled,
} from "@/lib/db/queries";
import { parseManualKeywordTtlHours } from "@/lib/manual-keywords";
import type { PipelineMode } from "@/lib/pipeline/mode";
import { runSnapshotPipeline } from "@/lib/pipeline/snapshot";

export const runtime = "nodejs";
export const revalidate = 0;

function parseId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function runOnDemandSnapshot(mode: PipelineMode) {
  try {
    const snapshotResult = await runSnapshotPipeline({ mode });
    return {
      ok: true as const,
      mode: snapshotResult.mode,
      snapshotId: snapshotResult.snapshotId,
      keywordCount: snapshotResult.keywordCount,
      reusedCount: snapshotResult.reusedCount,
    };
  } catch (snapshotErr) {
    return {
      ok: false as const,
      mode,
      error:
        snapshotErr instanceof Error
          ? snapshotErr.message
          : "on-demand snapshot failed",
    };
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          action?: unknown;
          ttlHours?: unknown;
        }
      | null;

    const action = typeof body?.action === "string" ? body.action : "";
    const ttlResult = parseManualKeywordTtlHours(body?.ttlHours);
    if (ttlResult.error) {
      return NextResponse.json({ error: ttlResult.error }, { status: 400 });
    }

    if (action === "extend") {
      const item = await extendManualKeyword(id, ttlResult.ttlHours ?? 6);
      if (!item) {
        return NextResponse.json({ error: "manual keyword not found" }, { status: 404 });
      }
      const onDemandSnapshot = await runOnDemandSnapshot(item.mode);
      return NextResponse.json({ ok: true, item, onDemandSnapshot });
    }

    if (action === "enable") {
      const item = await setManualKeywordEnabled(id, true);
      if (!item) {
        return NextResponse.json({ error: "manual keyword not found" }, { status: 404 });
      }
      const onDemandSnapshot = await runOnDemandSnapshot(item.mode);
      return NextResponse.json({ ok: true, item, onDemandSnapshot });
    }

    if (action === "disable") {
      const item = await setManualKeywordEnabled(id, false);
      if (!item) {
        return NextResponse.json({ error: "manual keyword not found" }, { status: 404 });
      }
      const onDemandSnapshot = await runOnDemandSnapshot(item.mode);
      return NextResponse.json({ ok: true, item, onDemandSnapshot });
    }

    return NextResponse.json(
      { error: "action must be one of: extend, enable, disable" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[/api/admin/manual-keywords/[id]][PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const item = await getManualKeywordById(id);
    if (!item) {
      return NextResponse.json({ error: "manual keyword not found" }, { status: 404 });
    }

    const deleted = await deleteManualKeyword(id);
    if (!deleted) {
      return NextResponse.json({ error: "manual keyword not found" }, { status: 404 });
    }

    const onDemandSnapshot = await runOnDemandSnapshot(item.mode);

    return NextResponse.json({ ok: true, onDemandSnapshot });
  } catch (err) {
    console.error("[/api/admin/manual-keywords/[id]][DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
