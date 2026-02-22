import { kv } from "@vercel/kv";

// ─── Cache keys ───────────────────────────────────────────────────────────────

const KEYS = {
  meta: "api:meta",
  trendsTop: (limit: number) => `api:trends:top:${limit}`,
  keywordDetail: (id: string, snapshotId: string) =>
    `api:keyword:${id}:${snapshotId}`,
};

// ─── TTLs (seconds) ───────────────────────────────────────────────────────────

const TTL = {
  meta: 60,
  trendsTop: 120,
  keywordDetail: 60 * 15, // 15분 (스냅샷 불변이므로 캐시 친화적)
};

// ─── Generic helpers ──────────────────────────────────────────────────────────

async function getOrSet<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const cached = await kv.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fetcher();
    await kv.set(key, fresh, { ex: ttl });
    return fresh;
  } catch {
    // KV 장애 시 fetcher fallback
    return fetcher();
  }
}

export async function invalidateApiCache(): Promise<void> {
  try {
    await kv.del(KEYS.meta);
    // trends top은 limit=10이 기본이므로 삭제
    await kv.del(KEYS.trendsTop(10));
  } catch {
    // ignore
  }
}

// ─── Typed cache accessors ────────────────────────────────────────────────────

export function cachedMeta<T>(fetcher: () => Promise<T>): Promise<T> {
  return getOrSet(KEYS.meta, TTL.meta, fetcher);
}

export function cachedTrendsTop<T>(
  limit: number,
  fetcher: () => Promise<T>
): Promise<T> {
  return getOrSet(KEYS.trendsTop(limit), TTL.trendsTop, fetcher);
}

export function cachedKeywordDetail<T>(
  keywordId: string,
  snapshotId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  return getOrSet(
    KEYS.keywordDetail(keywordId, snapshotId),
    TTL.keywordDetail,
    fetcher
  );
}
