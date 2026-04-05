import { NextRequest, NextResponse } from "next/server";
import {
  listYoutubeRecommendChannels,
  upsertYoutubeRecommendChannel,
} from "@/lib/db/queries";
import { resolveYoutubeChannel } from "@/lib/youtube-channel-resolver";

export const runtime = "nodejs";
export const revalidate = 0;

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

export async function GET() {
  try {
    const items = await listYoutubeRecommendChannels();
    return NextResponse.json({
      items,
      count: items.length,
    });
  } catch (err) {
    console.error("[/api/admin/youtube-source-channels][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
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
    const item = await upsertYoutubeRecommendChannel({
      channelId: resolved.channelId,
      channelName: resolved.channelName,
      channelHandle: resolved.channelHandle,
      channelUrl: resolved.channelUrl,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("required") || message.includes("이미 등록된") ? 400 : 500;
    if (status === 500) {
      console.error("[/api/admin/youtube-source-channels][POST]", err);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
