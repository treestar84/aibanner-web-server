/** MCP 도구용 인메모리 TTL 캐시.
 * 스냅샷은 하루 4회만 갱신되므로 짧은 TTL로도 캐시 적중률이 높다.
 * Vercel 서버리스 인스턴스별 메모리 — 완전한 공유 캐시는 아니지만
 * warm 인스턴스에서 평균 응답을 100ms 이내로 낮추는 것이 목적. */

interface CacheEntry { value: unknown; expiresAt: number; }
const store = new Map<string, CacheEntry>();
const MAX_ENTRIES = 200;

export async function getCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await loader();
  // 로더 실패 시(throw) 캐시에 저장하지 않음 — 오류 캐싱 금지
  if (value !== null && value !== undefined) {
    if (store.size >= MAX_ENTRIES) {
      // 가장 먼저 들어온 키부터 제거 (Map 삽입 순서 활용)
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: now + ttlMs });
  }
  return value;
}

export function clearCache(): void { store.clear(); }  // 테스트용
