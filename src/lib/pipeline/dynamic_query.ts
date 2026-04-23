import { getTopKeywords, getRecentSnapshots } from "../db/queries";

// Phase 2-A §4.2.4 (PRD 2026-04-23 · audit-B#L240-251):
// 한국어 사용자 우선 정책에 따라 GDELT broad 쿼리에 한국어 BASE term을 추가한다.
// 영문/한국어를 분리 export 하여 향후 locale별 가중 또는 테스트가 쉽도록 함.
export const BASE_TERMS_EN = [
  "AI", "LLM", "GPT", "Claude", "Gemini",
  "OpenAI", "Anthropic", "DeepSeek",
];

export const BASE_TERMS_KO = [
  "인공지능",
  "생성형 AI",
  "바이브 코딩",
  "오픈AI",
  "앤트로픽",
];

export const BASE_TERMS = [...BASE_TERMS_EN, ...BASE_TERMS_KO];

/**
 * 최근 3개 스냅샷의 키워드를 수집하되, 2회 이상 연속 Top에 오른
 * 키워드는 제외하여 echo chamber를 방지한다.
 * BASE_TERMS(EN 8 + KO 5 = 13) + 신규/희소 키워드(최대 7개) = 최대 20개.
 * GDELT URL 한도(8KB) 한참 미달.
 */
export async function buildDynamicQuery(): Promise<string> {
  try {
    const snapshots = await getRecentSnapshots(3);
    if (snapshots.length === 0) return BASE_TERMS.join(" OR ");

    // 각 스냅샷별 Top 10 키워드 수집
    const keywordLists = await Promise.all(
      snapshots.map((s) => getTopKeywords(s.snapshot_id, 10))
    );

    // 키워드별 등장 횟수 카운트
    const counts = new Map<string, { term: string; appearances: number }>();
    for (const list of keywordLists) {
      for (const kw of list) {
        const term = (kw.keyword_en || kw.keyword).trim();
        const key = term.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.appearances += 1;
        } else {
          counts.set(key, { term, appearances: 1 });
        }
      }
    }

    // 2회 이상 연속 등장한 키워드는 제외 (이미 RSS/broad에서 자연 유입됨)
    const dynamicTerms: string[] = [];
    for (const { term, appearances } of counts.values()) {
      if (appearances >= 2) continue;
      if (term.length < 3 || term.length > 30) continue;
      if (BASE_TERMS.some((b) => b.toLowerCase() === term.toLowerCase())) continue;
      dynamicTerms.push(term.includes(" ") ? `"${term}"` : term);
    }

    const allTerms = [...BASE_TERMS, ...dynamicTerms].slice(0, 20);
    return allTerms.join(" OR ");
  } catch (err) {
    console.warn("[dynamic_query] Failed, using base query:", (err as Error).message);
    return BASE_TERMS.join(" OR ");
  }
}
