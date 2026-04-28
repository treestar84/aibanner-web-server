import type { RssItem } from "./rss";

const SUBREDDITS = [
  "MachineLearning",
  "artificial",
  "LocalLLaMA",
  "vibecoding",
  "PromptEngineering",
  "cursor",
  "ClaudeAI",
  "ChatGPTCoding",
  "ollama",
  // audit-A#L239-240, #L344: 인디 빌더 / 신규 도구 발굴 채널
  "SideProject",
  "OpenAI",
  "aipromptprogramming",
  "IndieHacking",
];

interface RedditPost {
  data: {
    title: string;
    permalink: string;
    url: string;
    created_utc: number;
    score: number;
    num_comments: number;
    selftext?: string;
    link_flair_text?: string;
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

type RedditEndpoint = "hot" | "rising";

// Reddit blocks generic / cloud-egress User-Agents with 403/429.
// Use the Reddit-recommended UA format: "platform:appId:version (by /u/owner)".
// Override via env REDDIT_USER_AGENT for production accounts.
const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT ??
  "web:com.aitrendnews.widget:v1.0 (by /u/aitrendnews)";

// Optional OAuth (script app). When REDDIT_CLIENT_ID/SECRET are set we authenticate
// against oauth.reddit.com which is far less likely to be blocked from cloud IPs.
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID ?? "";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET ?? "";
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRedditAccessToken(): Promise<string | null> {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  try {
    const basic = Buffer.from(
      `${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`
    ).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "User-Agent": REDDIT_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[reddit_source] OAuth token HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    console.warn("[reddit_source] OAuth token failed:", (err as Error).message);
    return null;
  }
}

async function fetchSubreddit(
  subreddit: string,
  cutoff: Date,
  endpoint: RedditEndpoint = "hot"
): Promise<RssItem[]> {
  try {
    const limit = endpoint === "rising" ? 15 : 30;
    const accessToken = await getRedditAccessToken();
    const baseUrl = accessToken
      ? `https://oauth.reddit.com/r/${subreddit}/${endpoint}?limit=${limit}&raw_json=1`
      : `https://www.reddit.com/r/${subreddit}/${endpoint}.json?limit=${limit}&raw_json=1`;

    const headers: Record<string, string> = { "User-Agent": REDDIT_USER_AGENT };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(baseUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // Surface the status (401/403/429 vs 5xx) so we can tell IP block from rate limit.
      throw new Error(`HTTP ${res.status}${accessToken ? " (oauth)" : " (anon)"}`);
    }

    const data: RedditListing = await res.json();

    return data.data.children
      .filter((post) => {
        const created = new Date(post.data.created_utc * 1000);
        return created > cutoff && post.data.title;
      })
      .map((post) => ({
        title: post.data.title,
        link: `https://www.reddit.com${post.data.permalink}`,
        publishedAt: new Date(post.data.created_utc * 1000),
        summary: (post.data.selftext ?? "").slice(0, 500),
        sourceDomain: "reddit.com",
        feedTitle: `r/${subreddit}`,
        tier: "COMMUNITY" as const,
        lang: "en",
        engagement: {
          score: post.data.score,
          comments: post.data.num_comments,
        },
      }));
  } catch (err) {
    console.warn(
      `[reddit_source] r/${subreddit}/${endpoint} failed:`,
      (err as Error).message
    );
    return [];
  }
}

export async function collectRedditItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const all: RssItem[] = [];
  const seen = new Set<string>();

  for (const sub of SUBREDDITS) {
    // hot + rising 병렬 수집
    const [hotItems, risingItems] = await Promise.all([
      fetchSubreddit(sub, cutoff, "hot"),
      fetchSubreddit(sub, cutoff, "rising"),
    ]);

    for (const item of [...hotItems, ...risingItems]) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      all.push(item);
    }

    console.log(
      `[reddit_source] r/${sub}: ${hotItems.length} hot, ${risingItems.length} rising`
    );

    // Reddit rate limit: 1초 간격
    if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return all;
}
