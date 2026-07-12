export const YOUTUBE_VIDEO_TYPES = ["longform", "shorts", "unknown"] as const;
export const YOUTUBE_VIDEO_FILTERS = ["longform", "shorts", "all"] as const;

export type YouTubeVideoType = (typeof YOUTUBE_VIDEO_TYPES)[number];
export type YouTubeVideoFilter = (typeof YOUTUBE_VIDEO_FILTERS)[number];

const SHORTS_MAX_SECONDS = 180;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

export function parseYouTubeVideoFilter(
  value: string | null,
): YouTubeVideoFilter {
  if (value === "shorts" || value === "all") return value;
  return "longform";
}

export function parseYouTubeRecentLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, parsed));
}

export function normalizeYouTubeVideoType(value: unknown): YouTubeVideoType {
  return value === "longform" || value === "shorts" ? value : "unknown";
}

export function isShortsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").includes("shorts");
  } catch {
    return url.includes("/shorts/");
  }
}

export function toSafeYouTubeMetadataUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || !YOUTUBE_HOSTS.has(parsed.hostname)) {
    return null;
  }

  if (parsed.hostname === "youtu.be") {
    const videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (parsed.pathname === "/watch") {
    const videoId = parsed.searchParams.get("v") ?? "";
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" && /^[a-zA-Z0-9_-]{11}$/.test(parts[1] ?? "")) {
    return `https://www.youtube.com/shorts/${parts[1]}`;
  }

  return null;
}

export function classifyYouTubeVideo(input: {
  videoUrl: string;
  durationSeconds?: number | null;
}): YouTubeVideoType {
  if (isShortsUrl(input.videoUrl)) return "shorts";
  if (input.durationSeconds == null) return "unknown";
  return input.durationSeconds <= SHORTS_MAX_SECONDS ? "shorts" : "longform";
}

export function isVisibleForYouTubeFilter(
  type: YouTubeVideoType,
  filter: YouTubeVideoFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "shorts") return type === "shorts";
  return type === "longform" || type === "unknown";
}

export function parseDurationSecondsFromWatchHtml(html: string): number | null {
  const patterns = [
    /"lengthSeconds"\s*:\s*"(\d+)"/,
    /"lengthSeconds"\s*:\s*(\d+)/,
    /"approxDurationMs"\s*:\s*"(\d+)"/,
  ];

  for (const [index, pattern] of patterns.entries()) {
    const value = html.match(pattern)?.[1];
    if (!value) continue;
    if (index === 2) return Math.round(Number(value) / 1000);
    return Number(value);
  }

  return null;
}

/** YouTube Data API v3 `contentDetails.duration` ISO 8601 값 파서. */
export function parseYouTubeIsoDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}
