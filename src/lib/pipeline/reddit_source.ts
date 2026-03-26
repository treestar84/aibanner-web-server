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

async function fetchSubreddit(
  subreddit: string,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=30`,
      {
        headers: {
          "User-Agent": "AI-Trend-Widget/1.0",
        },
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
      `[reddit_source] r/${subreddit} failed:`,
      (err as Error).message
    );
    return [];
  }
}

export async function collectRedditItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // 순차 호출 (Reddit rate limit 방지)
  const all: RssItem[] = [];
  for (const sub of SUBREDDITS) {
    const items = await fetchSubreddit(sub, cutoff);
    console.log(`[reddit_source] r/${sub}: ${items.length} items`);
    all.push(...items);
    // Reddit rate limit: 1초 간격
    if (sub !== SUBREDDITS[SUBREDDITS.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return all;
}
