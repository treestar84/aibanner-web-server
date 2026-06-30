import type { RssItem } from "./rss";

// 벤더 공식 포럼(Discourse) 공지 카테고리 — 도구 기능 발표 전용 채널.
// "Bugbot is now 3x faster", "Cursor Python SDK" 같은 기능 발표는
// 뉴스 RSS·모델 카탈로그 어디에도 잡히지 않는 사각지대 신호다.
// Discourse는 카테고리 JSON을 무인증으로 제공한다.

export interface VendorForumConfig {
  vendor: string; // 제목 prefix ("Cursor")
  baseUrl: string; // "https://forum.cursor.com"
  categoryPath: string; // "/c/announcements/11.json"
  domain: string; // "forum.cursor.com"
}

export const VENDOR_FORUMS: VendorForumConfig[] = [
  {
    vendor: "Cursor",
    baseUrl: "https://forum.cursor.com",
    categoryPath: "/c/announcements/11.json",
    domain: "forum.cursor.com",
  },
  {
    vendor: "OpenAI",
    baseUrl: "https://community.openai.com",
    categoryPath: "/c/announcements/6.json",
    domain: "community.openai.com",
  },
];

export interface DiscourseTopic {
  id: number;
  title?: string | null;
  slug?: string | null;
  created_at?: string | null;
  like_count?: number | null;
  posts_count?: number | null;
}

export function mapDiscourseTopics(
  topics: readonly DiscourseTopic[],
  config: VendorForumConfig,
  cutoff: Date
): RssItem[] {
  const items: RssItem[] = [];

  for (const topic of topics) {
    const title = (topic.title ?? "").trim();
    if (!topic.id || !title || !topic.created_at) continue;

    // 공지 카테고리에는 고정(pinned) 옛 글이 섞이므로 작성 시각으로 필터
    const publishedAt = new Date(topic.created_at);
    if (Number.isNaN(publishedAt.getTime()) || !(publishedAt > cutoff)) continue;

    // 제목에 벤더명이 이미 있으면 prefix 생략 (키워드 추출 맥락 확보용)
    const needsPrefix = !title.toLowerCase().includes(config.vendor.toLowerCase());
    const fullTitle = needsPrefix ? `${config.vendor}: ${title}` : title;

    items.push({
      title: fullTitle,
      link: `${config.baseUrl}/t/${topic.slug ?? "topic"}/${topic.id}`,
      publishedAt,
      summary: "",
      sourceDomain: config.domain,
      feedTitle: `${config.vendor} Announcements`,
      tier: "P0_CURATED",
      lang: "en",
      engagement: {
        score: topic.like_count ?? 0,
        comments: Math.max(0, (topic.posts_count ?? 1) - 1),
      },
    });
  }

  return items;
}

async function fetchVendorForum(
  config: VendorForumConfig,
  cutoff: Date
): Promise<RssItem[]> {
  try {
    const res = await fetch(`${config.baseUrl}${config.categoryPath}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      topic_list?: { topics?: DiscourseTopic[] };
    };
    return mapDiscourseTopics(data.topic_list?.topics ?? [], config, cutoff);
  } catch (err) {
    console.warn(
      `[vendor_announcements] ${config.vendor} failed:`,
      (err as Error).message
    );
    return [];
  }
}

export async function collectVendorAnnouncementItems(
  windowHours = 72
): Promise<RssItem[]> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const results = await Promise.all(
    VENDOR_FORUMS.map((config) => fetchVendorForum(config, cutoff))
  );
  const items = results.flat();
  console.log(`[vendor_announcements] ${items.length} announcement(s)`);
  return items;
}
