import type { RssItem } from "./rss";

// Bluesky 공개 AppView API — SNS 발 신모델/신도구 신호 수집.
// 주의: public.api.bsky.app은 일부 네트워크에서 403을 반환하므로 api.bsky.app 사용.
// 무인증, rate limit 넉넉(IP당 3000req/5분).
const BSKY_API = "https://api.bsky.app/xrpc";

// 채널 A: 도메인 필터 검색 — 신규 도구/모델 링크가 포함된 포스트만.
// 일반 키워드 검색은 담론/논쟁 글로 오염되므로 사용하지 않는다.
export const BSKY_DOMAIN_SEARCHES: ReadonlyArray<{ q: string; domain: string }> = [
  { q: "ai", domain: "github.com" },
  { q: "model", domain: "huggingface.co" },
];

// 채널 B: 발표/릴리즈 큐레이션 계정 (2026-06 검증된 활성 계정)
export const BSKY_CURATED_ACCOUNTS: readonly string[] = [
  "unsloth.ai", // HF 모델 릴리즈 속보
  "clihub.org", // CLI 도구 릴리즈
  "github-trending-js.bsky.social", // GitHub 급상승 레포
];

// 검색 채널 스팸 방어: 좋아요+리포스트 최소값 (큐레이션 계정에는 미적용)
export const BSKY_SEARCH_MIN_ENGAGEMENT = 3;

// AI/개발 관련성 힌트 — 무관 포스트 차단용 경량 필터
const AI_DEV_HINT_RE =
  /\b(ai|llm|gpt|claude|gemini|qwen|deepseek|mistral|llama|openai|anthropic|cursor|copilot|codex|agent|agents|mcp|model|models|inference|coding|devtool|sdk|api|open[- ]?source|rag|prompt)\b/i;

export interface BskyPost {
  uri: string;
  author?: { handle?: string | null } | null;
  record?: { text?: string | null; createdAt?: string | null } | null;
  likeCount?: number | null;
  repostCount?: number | null;
  replyCount?: number | null;
}

function postRkey(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? "";
}

function buildPostTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function mapBskyPost(post: BskyPost): RssItem | null {
  const handle = post.author?.handle ?? "";
  const text = (post.record?.text ?? "").trim();
  const createdAt = post.record?.createdAt ?? "";
  if (!post.uri || !handle || !text || !createdAt) return null;

  const publishedAt = new Date(createdAt);
  if (Number.isNaN(publishedAt.getTime())) return null;

  return {
    title: buildPostTitle(text),
    link: `https://bsky.app/profile/${handle}/post/${postRkey(post.uri)}`,
    publishedAt,
    summary: text.slice(0, 500),
    sourceDomain: "bsky.app",
    feedTitle: `Bluesky @${handle}`,
    tier: "COMMUNITY",
    lang: "en",
    engagement: {
      score: (post.likeCount ?? 0) + (post.repostCount ?? 0),
      comments: post.replyCount ?? 0,
    },
  };
}

export function filterSearchPosts(posts: readonly BskyPost[], cutoff: Date): RssItem[] {
  const items: RssItem[] = [];
  for (const post of posts) {
    const engagement = (post.likeCount ?? 0) + (post.repostCount ?? 0);
    if (engagement < BSKY_SEARCH_MIN_ENGAGEMENT) continue;
    if (!AI_DEV_HINT_RE.test(post.record?.text ?? "")) continue;
    const item = mapBskyPost(post);
    if (item && item.publishedAt > cutoff) items.push(item);
  }
  return items;
}

export function filterCuratedPosts(posts: readonly BskyPost[], cutoff: Date): RssItem[] {
  const items: RssItem[] = [];
  for (const post of posts) {
    if (!AI_DEV_HINT_RE.test(post.record?.text ?? "")) continue;
    const item = mapBskyPost(post);
    if (item && item.publishedAt > cutoff) items.push(item);
  }
  return items;
}

async function fetchDomainSearch(
  query: { q: string; domain: string },
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const since = cutoff.toISOString();
    const url =
      `${BSKY_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query.q)}` +
      `&domain=${encodeURIComponent(query.domain)}&sort=top&since=${encodeURIComponent(since)}&limit=25`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { posts?: BskyPost[] };
    return filterSearchPosts(data.posts ?? [], cutoff);
  } catch (err) {
    console.warn(
      `[bluesky_source] search(${query.q}@${query.domain}) failed:`,
      (err as Error).message
    );
    return [];
  }
}

async function fetchAuthorFeed(actor: string, cutoff: Date): Promise<RssItem[]> {
  try {
    const url =
      `${BSKY_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}` +
      `&limit=20&filter=posts_no_replies`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { feed?: Array<{ post?: BskyPost }> };
    const posts = (data.feed ?? [])
      .map((entry) => entry.post)
      .filter((post): post is BskyPost => post != null);
    return filterCuratedPosts(posts, cutoff);
  } catch (err) {
    console.warn(`[bluesky_source] author(${actor}) failed:`, (err as Error).message);
    return [];
  }
}

export async function collectBlueskyItems(windowHours = 72): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const results = await Promise.all([
    ...BSKY_DOMAIN_SEARCHES.map((query) => fetchDomainSearch(query, cutoff)),
    ...BSKY_CURATED_ACCOUNTS.map((actor) => fetchAuthorFeed(actor, cutoff)),
  ]);

  // 채널 간 중복 제거 (link 기준)
  const seen = new Set<string>();
  const items: RssItem[] = [];
  for (const item of results.flat()) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  console.log(`[bluesky_source] ${items.length} post(s)`);
  return items;
}
