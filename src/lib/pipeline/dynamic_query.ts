import { getTopKeywords, getRecentSnapshots } from "../db/queries";

const BASE_TERMS = [
  "AI", "LLM", "GPT", "Claude", "Gemini",
  "OpenAI", "Anthropic", "DeepSeek",
];

/**
 * 최근 3개 스냅샷의 키워드를 수집하되, 2회 이상 연속 Top에 오른
 * 키워드는 제외하여 echo chamber를 방지한다.
 * BASE_TERMS(8개) + 신규/희소 키워드(최대 7개) = 최대 15개.
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

    const allTerms = [...BASE_TERMS, ...dynamicTerms].slice(0, 15);
    return allTerms.join(" OR ");
  } catch (err) {
    console.warn("[dynamic_query] Failed, using base query:", (err as Error).message);
    return BASE_TERMS.join(" OR ");
  }
}
