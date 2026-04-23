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

async function fetchSubreddit(
  subreddit: string,
  cutoff: Date,
  endpoint: RedditEndpoint = "hot"
): Promise<RssItem[]> {
  try {
    const limit = endpoint === "rising" ? 15 : 30;
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/${endpoint}.json?limit=${limit}`,
      {
        headers: { "User-Agent": "AI-Trend-Widget/1.0" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
