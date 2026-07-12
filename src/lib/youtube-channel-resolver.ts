import { buildYoutubeChannelUrl } from "@/lib/youtube-recommend-channels";

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_PATTERN = /^@[^/\s?#]+$/u;

export interface ResolvedYoutubeChannel {
  channelId: string;
  channelName: string;
  channelHandle: string;
  channelUrl: string;
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function normalizeInput(input: string): { channelId?: string; handle?: string } {
  const trimmed = input.normalize("NFKC").trim();
  if (!trimmed) throw new Error("YouTube 채널 링크를 입력해 주세요.");
  if (CHANNEL_ID_PATTERN.test(trimmed)) return { channelId: trimmed };
  if (HANDLE_PATTERN.test(trimmed)) return { handle: trimmed };

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || !["youtube.com", "m.youtube.com"].includes(normalizeHost(url.hostname))) {
      throw new Error("invalid");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 1 && HANDLE_PATTERN.test(segments[0] ?? "")) {
      return { handle: segments[0] };
    }
    if (segments.length === 2 && segments[0] === "channel" && CHANNEL_ID_PATTERN.test(segments[1] ?? "")) {
      return { channelId: segments[1] };
    }
  } catch {
    // 사용자에게 동일한 안전 입력 오류를 반환한다.
  }
  throw new Error("유효한 YouTube 채널 링크를 입력해 주세요.");
}

export async function resolveYoutubeChannel(
  rawInput: string,
): Promise<ResolvedYoutubeChannel> {
  const input = normalizeInput(rawInput);
  const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_DATA_API_KEY를 설정한 뒤 채널을 추가해 주세요.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("key", apiKey);
  if (input.channelId) url.searchParams.set("id", input.channelId);
  else url.searchParams.set("forHandle", input.handle!);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("YouTube Data API에서 채널 정보를 가져오지 못했습니다.");
  }
  if (!response.ok) throw new Error("YouTube Data API에서 채널 정보를 가져오지 못했습니다.");

  const body = (await response.json()) as {
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  };
  const item = body.items?.[0];
  const channelId = item?.id?.trim() ?? "";
  const channelName = item?.snippet?.title?.trim() ?? "";
  if (!CHANNEL_ID_PATTERN.test(channelId) || !channelName) {
    throw new Error("채널 ID 또는 이름을 확인할 수 없습니다.");
  }
  const channelHandle = item?.snippet?.customUrl?.trim() || input.handle || "";
  return {
    channelId,
    channelName,
    channelHandle,
    channelUrl: buildYoutubeChannelUrl(channelId, channelHandle),
  };
}
