import type { RssItem } from "./rss";
import OpenAI from "openai";

// ─── Generic term filter (hard filter — safety net after LLM extraction) ─────

const GENERIC_TERMS = new Set([
  // English standalone common nouns
  "ai", "agent", "agents", "model", "models", "llm", "openai", "google",
  "anthropic", "meta", "inference", "reasoning", "benchmark", "dataset",
  "machine learning", "deep learning", "neural network", "language model",
  "large language model", "transformer", "fine-tuning", "prompt", "chatbot",
  "multimodal", "open source", "open-source",
  // Korean
  "에이전트", "추론", "추론속도", "모델", "인공지능", "딥러닝", "머신러닝",
  "언어모델", "파인튜닝", "프롬프트", "챗봇", "오픈소스",
]);

// 복합 구 전체가 이 단어들로만 구성되면 generic phrase로 간주
const GENERIC_WORDS = new Set([
  "ai", "agent", "agents", "model", "models", "llm", "llms", "tool", "tools",
  "development", "application", "applications", "system", "systems",
  "powered", "enhanced", "based", "driven", "enabled", "focused",
  "platform", "service", "pipeline", "discussion", "use", "usage",
  "military", "industrial", "enterprise", "commercial", "startup", "startups",
  "new", "latest", "next", "generation", "gen", "advanced",
  "open", "source", "scale", "large", "small",
  "playlist", "playlists", "animation", "video", "audio",
  // language / vision / reasoning stack terms
  "language", "vision", "reasoning", "multimodal", "inference",
  "safety", "security", "privacy", "alignment", "interpretable",
  // research/market terms
  "market", "insights", "research", "analysis", "report", "trends", "trend",
  "industry", "business", "adoption", "deployment", "integration", "dynamics",
  // business/event terms
  "acquisition", "funding", "investment", "startup", "startups",
  "release", "launch", "update", "announcement",
  // descriptive adjectives
  "open", "source", "free", "fast", "efficient", "scalable", "capable",
  "capable", "reliable", "robust", "automated", "intelligent",
  // media/content terms
  "animation", "video", "audio", "playlist", "playlists", "content", "media",
  // extension/plugin/feature
  "plugin", "plugins", "extension", "extensions", "feature", "features",
  "capability", "capabilities", "functionality",
  // misc common nouns that don't anchor a specific entity
  "issues", "problems", "challenges", "concerns", "implications",
  "overview", "summary", "guide", "tutorial", "introduction",
  // web/data/realtime generic terms
  "real", "time", "realtime", "web", "data", "search", "query", "access",
  "retrieval", "online", "live", "stream", "streaming",
  // major company names (too generic alone without specific product)
  "google", "microsoft", "apple", "amazon", "nvidia", "intel", "samsung",
  // Korean generic single words (company names are handled via GENERIC_TERMS, but compound phrases need these)
  "에이전트", "모델", "플랫폼", "협업", "솔루션", "시스템", "서비스",
  "향상", "개선", "분석", "연구", "활용", "추진", "확대", "도입",
  "정확도", "성능", "속도", "효율", "비용", "비서", "자동화",
  "시장", "산업", "기업", "스타트업", "파트너십", "계약",
  // Step 3 추가: 한국어 generic 확장
  "확대", "인수", "기여", "공개", "탐지", "구축",
  "데이터", "엔지니어링", "프로젝트", "설계",
  "이후", "동시", "기반", "학습", "학습용",
  "음악", "마케팅", "애니메이션",
  "투자", "경제", "정책", "세액", "공제",
  "글로벌", "기술", "공격",
]);

/** 복합 구(2단어 이상)의 모든 유의미한 단어가 generic이면 true.
 *  전치사/관사(≤2자)는 의미없으므로 체크에서 제외. */
function isAllGenericPhrase(keyword: string): boolean {
  const words = keyword
    .toLowerCase()
    .replace(/[-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3); // 전치사/관사(in, of, at...) 제외
  if (words.length < 2) return false;
  return words.every((w) => GENERIC_WORDS.has(w));
}

// "AI Agent / AI 에이전트" 접두사 패턴: LLM이 빈번하게 생성하는 generic prefix.
// 뒤에 오는 단어들이 모두 generic이면 제거.
const AI_AGENT_PREFIX_RE = /^ai[\s-](?:agent[s]?|에이전트)\s*/i;

/** "AI Agent X" 또는 "AI 에이전트 X" 패턴에서 X가 proper noun 없이 descriptive하면 true */
function isGenericAiAgentPhrase(keyword: string): boolean {
  if (!AI_AGENT_PREFIX_RE.test(keyword)) return false;
  const remainder = keyword.replace(AI_AGENT_PREFIX_RE, "").trim();
  if (!remainder) return true;
  const words = remainder
    .toLowerCase()
    .replace(/[-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return words.every((w) => GENERIC_WORDS.has(w));
}

// ─── "AI 기반/모델/투자/학습용 X" generic prefix filter ─────────────────────
const AI_GENERIC_PREFIX_RE = /^ai[\s-](?:기반|모델|투자|학습용|활용|powered|based|driven|enabled)\s*/i;

function isGenericAiPrefixPhrase(keyword: string): boolean {
  if (!AI_GENERIC_PREFIX_RE.test(keyword)) return false;
  const remainder = keyword.replace(AI_GENERIC_PREFIX_RE, "").trim();
  if (!remainder) return true;
  const words = remainder.toLowerCase().replace(/[-]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  return words.every((w) => GENERIC_WORDS.has(w));
}

// ─── 4단어 초과 verbose 키워드 드롭 ──────────────────────────────────────────
function isTooVerbose(keyword: string): boolean {
  const PARTICLES = new Set(["의","에","를","을","이","가","와","과","및","for","the","a","an","of","in","to"]);
  const words = keyword.split(/\s+/).filter((w) => w.length >= 2 && !PARTICLES.has(w.toLowerCase()));
  return words.length > 4;
}

// ─── 기사 제목(헤드라인) 패턴 감지 ──────────────────────────────────────────
function isArticleHeadline(keyword: string): boolean {
  if (/[했한된할될]다/.test(keyword)) return true;       // 한국어 문장 종결어미
  if (/["'「」『』]/.test(keyword)) return true;          // 인용부호
  if (/\d+\s*[종개건가지]/.test(keyword)) return true;   // "53종", "10개"
  return false;
}

// ─── 비AI 토픽 하드 필터 ────────────────────────────────────────────────────
const NON_AI_TOPICS = new Set([
  "euv", "세차장", "cctv", "세액공제", "gdp",
  "부동산", "자동차", "레이트 리밋", "rate limit",
]);

function isNonAiTopic(keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return [...NON_AI_TOPICS].some((t) => lower.includes(t));
}

// ─── 한국어 음차 잔여 감지 ──────────────────────────────────────────────────
function hasKoreanTransliteration(keyword: string): boolean {
  const tokens = keyword.split(/\s+/);
  for (const token of tokens) {
    if (/[a-zA-Z]/.test(token) && /[\uAC00-\uD7AF]/.test(token) && token.includes("-")) return true;
  }
  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeywordCandidate {
  text: string;
  count: number;
  domains: Set<string>;
  latestAt: Date;
  tier: string;
}

export interface NormalizedKeyword {
  keywordId: string;   // canonical ID (slug)
  keyword: string;     // 표시용 문자열
  aliases: string[];
  candidates: KeywordCandidate;
}

// ─── Slugify ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  const hasKorean = /[\uAC00-\uD7AF\u3130-\u318F\u1100-\u11FF]/.test(text);

  if (!hasKorean) {
    const ascii = text
      .toLowerCase()
      .replace(/[_\-.]+/g, " ")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, "_")
      .trim();
    if (ascii.replace(/_/g, "").length >= 2) return ascii;
  }

  // 한국어 포함 텍스트 또는 너무 짧은 ASCII → 충돌 방지 해시
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) >>> 0;
  }
  return `kw_${hash.toString(36)}`;
}

// ─── LLM Extraction Prompt ──────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a keyword extractor for a developer-focused AI trend tracker.
Target audience: developers who use AI coding tools (Cursor, Claude Code, Copilot, Windsurf).

You will receive numbered news article titles with [TIER] prefixes indicating source authority.

## YOUR TASK
Extract concise, search-friendly trending keywords. Each keyword should be something a developer might type into a search engine.

## KEYWORD FORMAT
1. Keep keywords SHORT: 1-3 words ideal, 4 words maximum.
2. Prefer: product names, tool names, version releases, named initiatives, specific APIs.
3. Good: "Electrobun", "gpt-realtime-1.5 API", "Ladybird Rust", "OpenClaw Stella", "Pixel Agents"
4. Bad: "Claude가 우리 스타트업을 죽였다" (headline), "AI 기반 프로젝트 설계 에이전트" (verbose/generic)

## LANGUAGE RULES — CRITICAL
- Product/model/API names, version numbers: ALWAYS original English.
  CORRECT: "gpt-realtime-1.5"  WRONG: "gpt-리얼타임-1.5"
  CORRECT: "Claude Code"       WRONG: "클로드 코드"
- Korean ONLY for short action/context suffixes (1-2 words):
  "Hetzner 가격 인상", "Codex 하네스 활용", "AI 노트테이커"
- NEVER transliterate English to Korean phonetic (음차).

## EXTRACT
- New product/tool launches (Electrobun, ProducerAI, OpenClaw Stella)
- API or model releases (gpt-realtime-1.5 API, Gemini 2.5 Pro)
- Named initiatives (OpenAI Frontier Alliance, Google Cloud AI)
- Developer tool integrations (Cursor like 익스텐션, Codex 하네스 활용)
- Infrastructure changes relevant to developers (Hetzner 가격 인상)

## SKIP — DO NOT EXTRACT
- Article headlines or clickbait (anything reading like a sentence)
- Generic AI: "AI 기반 X", "AI 모델 X", "AI 투자 X", "AI 학습용 X"
- Policy, regulation, tax, GDP, market analysis
- Non-AI topics: hardware manufacturing, automotive, CCTV, construction
- Company name alone without product/event ("OpenAI", "Google")
- More than 4 words = too long

## DUPLICATES
Same topic different phrasing → extract ONE keyword only.
"Ladybird Rust 채택" + "Ladybird Rust 도입" → "Ladybird Rust"

Extract 20-35 keywords. Quality over quantity.

Return JSON array only:
[
  {"keyword": "gpt-realtime-1.5 API", "aliases": ["gpt-realtime-1.5", "GPT Realtime API"]},
  {"keyword": "Electrobun", "aliases": ["electrobun"]}
]`;

// ─── Title Batching ─────────────────────────────────────────────────────────

const MAX_TITLES_PER_BATCH = 200;

const TIER_ORDER: Record<string, number> = {
  P0_CURATED: 0,
  P1_CONTEXT: 1,
  P2_RAW: 2,
  COMMUNITY: 3,
};

interface TitleEntry {
  index: number;
  title: string;
  tier: string;
  sourceDomain: string;
}

function prepareTitleBatches(items: RssItem[]): TitleEntry[][] {
  // 제목 중복 제거 (trim + lowercase 기준)
  const seen = new Set<string>();
  const unique: TitleEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const key = items[i].title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      index: i,
      title: items[i].title.trim(),
      tier: items[i].tier,
      sourceDomain: items[i].sourceDomain,
    });
  }

  // tier 우선순위 정렬 (P0 → P1 → P2 → COMMUNITY)
  unique.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));

  // 배치 분할
  const batches: TitleEntry[][] = [];
  for (let i = 0; i < unique.length; i += MAX_TITLES_PER_BATCH) {
    batches.push(unique.slice(i, i + MAX_TITLES_PER_BATCH));
  }
  return batches;
}

function formatBatchForLLM(batch: TitleEntry[]): string {
  return batch
    .map((entry, i) => `${i + 1}. [${entry.tier}] ${entry.title}`)
    .join("\n");
}

// ─── LLM Keyword Extraction ────────────────────────────────────────────────

interface LLMKeyword {
  keyword: string;
  aliases: string[];
}

async function extractKeywordsViaLLM(
  batches: TitleEntry[][]
): Promise<LLMKeyword[]> {
  if (batches.length === 0) return [];

  const client = new OpenAI();
  const allKeywords: LLMKeyword[] = [];

  for (const batch of batches) {
    const userContent = formatBatchForLLM(batch);
    try {
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content ?? "[]";
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn("[keywords] LLM returned no JSON array, skipping batch");
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.keyword && Array.isArray(item.aliases)) {
            allKeywords.push(item);
          }
        }
      }
    } catch (err) {
      console.warn("[keywords] LLM extraction failed for batch:", err);
    }
  }

  // 배치 간 중복 병합 (canonical lowercase 기준, aliases 합집합)
  const merged = new Map<string, LLMKeyword>();
  for (const kw of allKeywords) {
    const key = kw.keyword.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      const aliasSet = new Set([...existing.aliases, ...kw.aliases]);
      existing.aliases = [...aliasSet];
    } else {
      merged.set(key, { keyword: kw.keyword, aliases: [...kw.aliases] });
    }
  }

  const result = [...merged.values()];
  console.log(`[keywords] LLM extracted ${result.length} keywords`);

  // fallback: LLM이 아무것도 반환하지 않으면 regex 기반 추출
  if (result.length === 0) {
    console.warn("[keywords] LLM returned 0 keywords, using regex fallback");
    return regexFallbackExtract(batches);
  }

  return result;
}

function regexFallbackExtract(batches: TitleEntry[][]): LLMKeyword[] {
  const found = new Set<string>();
  for (const batch of batches) {
    for (const entry of batch) {
      const tokens = entry.title.split(/\s+/);
      for (const token of tokens) {
        // CamelCase: LangGraph, CrewAI
        if (/^[A-Z][a-z]+[A-Z]/.test(token)) found.add(token);
        // Model version pattern: GPT-4.1, Qwen2.5, Claude-3.5
        if (/^[A-Za-z]+-?\d+(\.\d+)?$/.test(token) && token.length >= 4) found.add(token);
      }
    }
  }
  return [...found].map((kw) => ({ keyword: kw, aliases: [kw.toLowerCase()] }));
}

// ─── Match Keywords to Items ────────────────────────────────────────────────

// 매칭 시 의미없는 접속사/전치사는 필수 단어에서 제외
const MATCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "has",
  "new", "how", "via", "its", "into", "over", "under", "using", "based",
  "의", "에", "을", "를", "이", "가", "와", "과",
]);

/**
 * 검색어가 haystack에 매칭되는지 판단한다.
 *
 * - 단일 단어(또는 2자 이하): whole-word 또는 substring 매칭
 * - 복합 구(2단어 이상): MATCH_STOPWORDS를 제외한 모든 유의미한 단어가
 *   haystack에 존재해야 매칭 (순서 무관).
 *   이를 통해 "Claude Code Teams"가 "Claude Code introduces Teams feature"에도 매칭된다.
 */
function termMatchesHaystack(term: string, haystack: string): boolean {
  const lowerTerm = term.toLowerCase();

  // 짧은 단어: whole-word 매칭
  if (lowerTerm.length <= 2) {
    const regex = new RegExp(
      `\\b${lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
    );
    return regex.test(haystack);
  }

  const words = lowerTerm
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w));

  if (words.length <= 1) {
    // 단일 유의미 단어: substring 매칭
    return haystack.includes(lowerTerm);
  }

  // 복합 구: 모든 유의미한 단어가 haystack에 존재해야 함
  return words.every((w) => haystack.includes(w));
}

// 한국어 음차가 포함된 키워드에서 ASCII 부분만 추출하여 추가 검색어 생성
// "OpenAI gpt-리얼타임-1.5 API" → "OpenAI gpt- -1.5 API" → "OpenAI gpt 1.5 API"
const KOREAN_RE = /[\uAC00-\uD7AF\u3130-\u318F\u1100-\u11FF]+/g;

function generateAsciiVariants(keyword: string, aliases: string[]): string[] {
  const variants: string[] = [];
  for (const text of [keyword, ...aliases]) {
    if (!KOREAN_RE.test(text)) continue;
    KOREAN_RE.lastIndex = 0; // reset regex state
    const ascii = text
      .replace(KOREAN_RE, " ")
      .replace(/[-·]\s/g, " ")
      .replace(/\s[-·]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (ascii.length >= 3) variants.push(ascii);
  }
  return variants;
}

function matchKeywordsToItems(
  keywords: LLMKeyword[],
  items: RssItem[]
): Map<string, KeywordCandidate> {
  const result = new Map<string, KeywordCandidate>();

  for (const kw of keywords) {
    const asciiVariants = generateAsciiVariants(kw.keyword, kw.aliases);
    const searchTerms = [kw.keyword, ...kw.aliases, ...asciiVariants];
    const candidate: KeywordCandidate = {
      text: kw.keyword,
      count: 0,
      domains: new Set(),
      latestAt: new Date(0),
      tier: "P2_RAW",
    };

    for (const item of items) {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      const matched = searchTerms.some((term) =>
        termMatchesHaystack(term, haystack)
      );

      if (matched) {
        candidate.count++;
        candidate.domains.add(item.sourceDomain);
        if (item.publishedAt > candidate.latestAt) {
          candidate.latestAt = item.publishedAt;
        }
        // 최고 tier 유지
        if ((TIER_ORDER[item.tier] ?? 9) < (TIER_ORDER[candidate.tier] ?? 9)) {
          candidate.tier = item.tier;
        }
      }
    }

    result.set(kw.keyword.toLowerCase(), candidate);
  }

  return result;
}

// ─── Deduplication (trailing action word 병합) ──────────────────────────────

const TRAILING_ACTION_WORDS = new Set([
  "도입", "채택", "활용", "공개", "출시", "발표", "확대", "추진",
  "적용", "업데이트", "통합", "지원", "강화", "개선",
]);

function deduplicateKeywords(keywords: LLMKeyword[]): LLMKeyword[] {
  function getCore(kw: string): string {
    const words = kw.split(/\s+/);
    if (words.length >= 2 && TRAILING_ACTION_WORDS.has(words[words.length - 1])) {
      return words.slice(0, -1).join(" ").toLowerCase();
    }
    return kw.toLowerCase();
  }
  const coreMap = new Map<string, LLMKeyword>();
  for (const kw of keywords) {
    const core = getCore(kw.keyword);
    const existing = coreMap.get(core);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...kw.aliases, kw.keyword])];
    } else {
      coreMap.set(core, { ...kw, aliases: [...kw.aliases] });
    }
  }
  return [...coreMap.values()];
}

// ─── Main: normalizeKeywords ────────────────────────────────────────────────

export async function normalizeKeywords(
  items: RssItem[]
): Promise<NormalizedKeyword[]> {
  // 1. 제목 배치 준비
  const batches = prepareTitleBatches(items);
  console.log(
    `[keywords] Prepared ${batches.length} batch(es) from ${items.length} items`
  );

  // 2. LLM 키워드 추출 + 중복 병합
  const rawLlmKeywords = await extractKeywordsViaLLM(batches);
  const llmKeywords = deduplicateKeywords(rawLlmKeywords);
  console.log(`[keywords] After dedup: ${rawLlmKeywords.length} → ${llmKeywords.length} keywords`);

  // 3. 아이템 매칭 → scoring 메타데이터 복원
  const candidateMap = matchKeywordsToItems(llmKeywords, items);

  // 4. NormalizedKeyword 배열 구성 + GENERIC_TERMS 필터
  const result: NormalizedKeyword[] = [];
  console.log(`[keywords] --- Filtering pipeline (${llmKeywords.length} candidates) ---`);

  for (const kw of llmKeywords) {
    const candidate = candidateMap.get(kw.keyword.toLowerCase());

    if (!candidate || candidate.count === 0) {
      console.log(`[keywords] DROP(no_match)       : "${kw.keyword}"`);
      continue;
    }
    if (GENERIC_TERMS.has(kw.keyword.toLowerCase())) {
      console.log(`[keywords] DROP(generic_term)   : "${kw.keyword}"`);
      continue;
    }
    if (isAllGenericPhrase(kw.keyword)) {
      console.log(`[keywords] DROP(all_generic)    : "${kw.keyword}"`);
      continue;
    }
    if (isGenericAiAgentPhrase(kw.keyword)) {
      console.log(`[keywords] DROP(ai_agent_prefix): "${kw.keyword}"`);
      continue;
    }
    if (isGenericAiPrefixPhrase(kw.keyword)) {
      console.log(`[keywords] DROP(ai_prefix_generic): "${kw.keyword}"`);
      continue;
    }
    if (isTooVerbose(kw.keyword)) {
      console.log(`[keywords] DROP(too_verbose)    : "${kw.keyword}"`);
      continue;
    }
    if (isArticleHeadline(kw.keyword)) {
      console.log(`[keywords] DROP(article_headline): "${kw.keyword}"`);
      continue;
    }
    if (isNonAiTopic(kw.keyword)) {
      console.log(`[keywords] DROP(non_ai_topic)  : "${kw.keyword}"`);
      continue;
    }
    if (hasKoreanTransliteration(kw.keyword)) {
      console.log(`[keywords] DROP(korean_translit): "${kw.keyword}"`);
      continue;
    }

    console.log(`[keywords] KEEP (count=${candidate.count}, tier=${candidate.tier}): "${kw.keyword}"`);
    result.push({
      keywordId: slugify(kw.keyword),
      keyword: kw.keyword,
      aliases: kw.aliases,
      candidates: candidate,
    });
  }

  console.log(
    `[keywords] Final: ${result.length} keywords after matching and filtering`
  );
  return result;
}
