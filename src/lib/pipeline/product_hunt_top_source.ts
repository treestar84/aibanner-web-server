import type { RssItem, RssRankingSignal } from "./rss";

const PRODUCT_HUNT_API_URL = "https://api.producthunt.com/v2/api/graphql";
const PRODUCT_HUNT_TOP_FETCH_LIMIT = 20;
const PRODUCT_HUNT_MIN_LOOKBACK_HOURS = 48;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const AI_DEV_HINT_RE =
  /\b(ai|artificial intelligence|llm|gpt|claude|gemini|openai|anthropic|cursor|copilot|agent|agents|assistant|assistants|prompt|prompts|rag|model|models|mcp|api|apis|sdk|developer|developers|devtool|devtools|coding|code|workflow|automation|automated)\b/i;

interface ProductHuntTopicNode {
  slug?: string | null;
  name?: string | null;
}

export interface ProductHuntPost {
  id: string;
  name: string;
  tagline: string;
  url: string;
  website?: string | null;
  featuredAt?: string | null;
  createdAt: string;
  dailyRank?: number | null;
  votesCount: number;
  topics?: {
    edges?: Array<{
      node?: ProductHuntTopicNode | null;
    }> | null;
  } | null;
}

interface ProductHuntPostsResponse {
  data?: {
    posts?: {
      nodes?: ProductHuntPost[] | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string | null }> | null;
}

function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year") ?? "0000";
  const month = byType.get("month") ?? "00";
  const day = byType.get("day") ?? "00";
  return `${year}-${month}-${day}`;
}

export function getPacificDateKey(date: Date): string {
  return formatDateKeyInTimeZone(date, PACIFIC_TIME_ZONE);
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function buildPostedAfterIso(windowHours: number): string {
  const effectiveWindowHours = Math.max(
    PRODUCT_HUNT_MIN_LOOKBACK_HOURS,
    Math.floor(windowHours)
  );
  return new Date(
    Date.now() - effectiveWindowHours * 60 * 60 * 1000
  ).toISOString();
}

function extractTopicTexts(post: ProductHuntPost): string[] {
  return (
    post.topics?.edges
      ?.map((edge) => edge.node)
      .filter((node): node is ProductHuntTopicNode => Boolean(node))
      .flatMap((node) => [node.slug ?? "", node.name ?? ""]) ?? []
  )
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isLikelyAiDeveloperLaunch(post: ProductHuntPost): boolean {
  const haystack = [
    post.name,
    post.tagline,
    post.website ?? "",
    ...extractTopicTexts(post),
  ].join(" ");
  return AI_DEV_HINT_RE.test(haystack);
}

export function resolveProductHuntRankingSignal(
  dailyRank: number | null | undefined
): RssRankingSignal {
  const rank =
    typeof dailyRank === "number" && Number.isFinite(dailyRank) && dailyRank > 0
      ? Math.floor(dailyRank)
      : null;

  if (rank !== null && rank <= 3) {
    return {
      sourceKey: "product_hunt_top",
      authorityOverride: 0.9,
      domainBonus: 2,
      rank,
    };
  }

  if (rank !== null && rank <= 10) {
    return {
      sourceKey: "product_hunt_top",
      authorityOverride: 0.84,
      domainBonus: 1,
      rank,
    };
  }

  return {
    sourceKey: "product_hunt_top",
    authorityOverride: 0.72,
    domainBonus: 0.5,
    rank,
  };
}

export function isCurrentPacificTopLaunch(
  post: ProductHuntPost,
  todayPacificKey: string
): boolean {
  const featuredAt = post.featuredAt ? new Date(post.featuredAt) : null;
  if (!featuredAt || Number.isNaN(featuredAt.getTime())) return false;
  if (
    typeof post.dailyRank !== "number" ||
    !Number.isFinite(post.dailyRank) ||
    post.dailyRank <= 0
  ) {
    return false;
  }
  return getPacificDateKey(featuredAt) === todayPacificKey;
}

export async function collectProductHuntTopItems(
  windowHours = 72
): Promise<RssItem[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN?.trim();
  if (!token) {
    console.log("[product_hunt_top] No PRODUCT_HUNT_TOKEN, skipping");
    return [];
  }

  const query = `
    query ProductHuntTopToday($first: Int!, $featured: Boolean!, $order: PostsOrder!, $postedAfter: DateTime!) {
      posts(first: $first, featured: $featured, order: $order, postedAfter: $postedAfter) {
        nodes {
          id
          name
          tagline
          url
          website
          featuredAt
          createdAt
          dailyRank
          votesCount
          topics(first: 8) {
            edges {
              node {
                slug
                name
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(PRODUCT_HUNT_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          first: PRODUCT_HUNT_TOP_FETCH_LIMIT,
          featured: true,
          order: "RANKING",
          postedAfter: buildPostedAfterIso(windowHours),
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload = (await res.json()) as ProductHuntPostsResponse;
    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors[0]?.message?.trim() || "Unknown GraphQL error";
      throw new Error(message);
    }

    const posts = payload.data?.posts?.nodes ?? [];
    const todayPacificKey = getPacificDateKey(new Date());
    const topTodayPosts = posts
      .filter((post) => isCurrentPacificTopLaunch(post, todayPacificKey))
      .filter(isLikelyAiDeveloperLaunch)
      .sort((a, b) => (a.dailyRank ?? 999) - (b.dailyRank ?? 999));

    const items = topTodayPosts.map((post) => {
      const rankingSignal = resolveProductHuntRankingSignal(post.dailyRank);
      const rankLabel =
        typeof post.dailyRank === "number" && Number.isFinite(post.dailyRank)
          ? `Product Hunt #${post.dailyRank}`
          : "Product Hunt featured";
      const votesLabel = `${post.votesCount} votes`;

      return {
        title: post.tagline
          ? `${post.name} — ${post.tagline}`
          : post.name,
        link: sanitizeUrl(post.url),
        publishedAt: new Date(post.featuredAt ?? post.createdAt),
        summary: `${rankLabel} · ${votesLabel}`,
        sourceDomain: "producthunt.com",
        feedTitle: "Product Hunt Top Today",
        tier: "P1_CONTEXT" as const,
        lang: "en",
        rankingSignals: [rankingSignal],
        engagement: {
          score: post.votesCount,
          comments: 0,
        },
      } satisfies RssItem;
    });

    console.log(
      `[product_hunt_top] Got ${items.length} AI/dev top items (today=${todayPacificKey})`
    );
    return items;
  } catch (err) {
    console.warn("[product_hunt_top] Failed:", (err as Error).message);
    return [];
  }
}
