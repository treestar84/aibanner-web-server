import { NextRequest, NextResponse } from "next/server";
import {
  deleteYoutubeRecommendChannel,
  getYoutubeRecommendChannelById,
  updateYoutubeRecommendChannel,
} from "@/lib/db/queries";
import { resolveYoutubeChannel } from "@/lib/youtube-channel-resolver";

export const runtime = "nodejs";
export const revalidate = 0;

function parseId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseRequiredText(
  value: unknown,
  field: string,
  maxLength: number
): { value?: string; error?: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { error: `${field} is required` };
  if (text.length > maxLength) {
    return { error: `${field} must be ${maxLength} chars or fewer` };
  }
  return { value: text };
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
          channelUrl?: unknown;
        }
      | null;

    const channelUrlResult = parseRequiredText(body?.channelUrl, "channelUrl", 500);
    if (channelUrlResult.error) {
      return NextResponse.json({ error: channelUrlResult.error }, { status: 400 });
    }

    const resolved = await resolveYoutubeChannel(channelUrlResult.value ?? "");
    const item = await updateYoutubeRecommendChannel(id, {
      channelId: resolved.channelId,
      channelName: resolved.channelName,
      channelHandle: resolved.channelHandle,
      channelUrl: resolved.channelUrl,
    });
    if (!item) {
      return NextResponse.json({ error: "youtube source channel not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("required") || message.includes("이미 등록된") ? 400 : 500;
    if (status === 500) {
      console.error("[/api/admin/youtube-source-channels/[id]][PATCH]", err);
    }
    return NextResponse.json({ error: message }, { status });
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

    const current = await getYoutubeRecommendChannelById(id);
    if (!current) {
      return NextResponse.json({ error: "youtube source channel not found" }, { status: 404 });
    }

    const deleted = await deleteYoutubeRecommendChannel(id);
    if (!deleted) {
      return NextResponse.json({ error: "youtube source channel not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/youtube-source-channels/[id]][DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
