import type { RssItem } from "./rss";
import OpenAI from "openai";
import { isExactlyExcludedKeyword } from "./keyword_exclusions";
import type { PipelineMode } from "./mode";

// ─── Generic term filter (hard filter — safety net after LLM extraction) ─────

const GENERIC_TERMS = new Set([
  // English standalone common nouns
  "ai", "ml", "dl", "rl", "nlp",
  "agent", "agents", "model", "models", "llm", "openai", "google",
  "anthropic", "meta", "inference", "reasoning", "benchmark", "dataset",
  "machine learning", "deep learning", "neural network", "language model",
  "large language model", "transformer", "fine-tuning", "prompt", "chatbot",
  "multimodal", "open source", "open-source",
  // Generic AI compound phrases
  "ai agents", "ai tools", "ai apps", "llm agents", "ml models", "ai models",
  // Korean
  "에이전트", "추론", "추론속도", "모델", "인공지능", "딥러닝", "머신러닝",
  "언어모델", "파인튜닝", "프롬프트", "챗봇", "오픈소스",
]);

// 복합 구 전체가 이 단어들로만 구성되면 generic phrase로 간주
const GENERIC_WORDS = new Set([
  // 2-char tech acronyms (short but generic alone)
  "ai", "ml", "dl", "rl", "cv",
  // Common tech nouns
  "agent", "agents", "model", "models", "llm", "llms", "tool", "tools",
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

// 전치사/관사: 의미 없는 1-2자 기능어 (ai, ml 같은 기술 약어는 별도 GENERIC_WORDS로 처리)
const FUNCTION_WORDS = new Set(["a", "an", "in", "of", "at", "to", "by", "on", "as", "or"]);

/** 복합 구(2단어 이상)의 모든 유의미한 단어가 generic이면 true.
 *  전치사/관사만 제거하고, ai·ml 같은 2자 기술 약어는 GENERIC_WORDS에서 처리. */
function isAllGenericPhrase(keyword: string): boolean {
  const words = keyword
    .toLowerCase()
    .replace(/[-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 1 && !FUNCTION_WORDS.has(w));
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

// ─── 미디어 매체명 필터 (뉴스 소스명이 키워드로 추출되는 것을 방지) ──────────
const MEDIA_OUTLETS = new Set([
  "techcrunch", "the verge", "wired", "engadget", "venturebeat",
  "arstechnica", "ars technica", "the information", "bloomberg", "reuters",
  "bbc", "cnn", "nytimes", "washington post", "hacker news", "hackernews",
  "reddit", "youtube", "twitter", "linkedin", "producthunt", "product hunt",
  "geekwire", "zdnet", "cnet", "techradar", "geeknews", "zdnet korea",
  "mit technology review", "ben's bites", "semianalysis", "latent space",
]);

function isMediaOutlet(keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return [...MEDIA_OUTLETS].some(
    (outlet) => lower === outlet || lower.startsWith(outlet + " ") || lower.endsWith(" " + outlet)
  );
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
  matchedItems: Set<number>;
  latestAt: Date;
  tier: string;
  domainBonus: number;
  authorityOverride: number;
}

export interface NormalizedKeyword {
  keywordId: string;   // canonical ID (slug)
  keyword: string;     // 표시용 문자열
  aliases: string[];
  candidates: KeywordCandidate;
}

const HANGUL_RE_CHAR = /[\uAC00-\uD7AF\u3130-\u318F\u1100-\u11FF]/;
const ASCII_RE_CHAR = /[a-z]/i;
const MINOR_VARIANT_WORDS = new Set([
  "small", "mini", "micro", "lite", "base", "core",
  "pro", "plus", "max", "large", "turbo",
  "스몰", "미니", "라이트", "베이스", "프로", "플러스", "맥스", "라지",
]);
const CONTEXT_HEAD_HINTS = new Set([
  "mode", "modes", "feature", "features", "assistant", "assistants",
  "workflow", "workflows", "plugin", "plugins", "extension", "extensions",
  "integration", "integrations", "capability", "capabilities",
  "voice", "audio", "chat", "agent", "agents",
  "모드", "기능", "업데이트", "연동", "통합", "보이스", "음성", "도우미",
]);
const CONTEXT_HEAD_SUFFIX_RE = /(mode|feature|assistant|workflow|plugin|extension|integration|capability|voice|audio|chat|agent|모드|기능|업데이트|연동|통합|보이스|음성)$/i;

function normalizeKeywordSurface(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    // qwen3.5 -> qwen 3.5 (버전 표기 토큰 분리)
    .replace(/([a-z])(\d+(?:\.\d+)?)(?=\b)/gi, "$1 $2")
    .replace(/[_\-·/]+/g, " ")
    .replace(/[“”"'`~!@#$%^&*()+=[\]{}|\\:;<>?,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKeywordSurface(text: string): string {
  return normalizeKeywordSurface(text).replace(/[.\s]+/g, "");
}

function trimMinorVariantSuffix(text: string): string {
  const words = normalizeKeywordSurface(text).split(/\s+/).filter(Boolean);
  while (words.length > 1 && MINOR_VARIANT_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

function extractVersionTokens(text: string): Set<string> {
  const matches = normalizeKeywordSurface(text).match(/\d+(?:\.\d+){0,2}/g) ?? [];
  return new Set(matches);
}

function extractAsciiCoreTokens(text: string): Set<string> {
  const tokens = normalizeKeywordSurface(text)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => /[a-z]/.test(token) && token.length >= 3 && !MINOR_VARIANT_WORDS.has(token));
  return new Set(tokens);
}

function hasHangulChars(text: string): boolean {
  return HANGUL_RE_CHAR.test(text);
}

function hasAsciiChars(text: string): boolean {
  return ASCII_RE_CHAR.test(text);
}

function tokenizeKeyword(text: string): string[] {
  return normalizeKeywordSurface(text).split(/\s+/).filter(Boolean);
}

function isContextHeadToken(token: string): boolean {
  if (!token) return false;
  return CONTEXT_HEAD_HINTS.has(token) || CONTEXT_HEAD_SUFFIX_RE.test(token);
}

function extractAnchorLikeTokensFromKeyword(text: string): string[] {
  return tokenizeKeyword(text).filter((token) => {
    if (token.length < 2) return false;
    if (GENERIC_WORDS.has(token)) return false;
    if (FUNCTION_WORDS.has(token)) return false;
    if (MATCH_STOPWORDS.has(token)) return false;
    if (isContextHeadToken(token)) return false;
    return /[a-z0-9\uAC00-\uD7AF]/i.test(token);
  });
}

function isContextDependentKeyword(text: string): boolean {
  const tokens = tokenizeKeyword(text);
  if (tokens.length === 0) return false;
  const anchorTokens = extractAnchorLikeTokensFromKeyword(text);
  if (anchorTokens.length > 0) return false;

  if (tokens.every((token) => isContextHeadToken(token))) return true;
  if (tokens.length === 2 && GENERIC_WORDS.has(tokens[0]) && isContextHeadToken(tokens[1])) return true;
  return false;
}

function getSetIntersectionSize<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) {
    if (large.has(value)) intersection++;
  }
  return intersection;
}

function buildContextEnrichedKeyword(anchorKeyword: string, headKeyword: string): string {
  const anchor = anchorKeyword.trim();
  const head = headKeyword.trim();
  if (!anchor) return head;
  if (!head) return anchor;

  const anchorNormalized = normalizeKeywordSurface(anchor);
  const headNormalized = normalizeKeywordSurface(head);
  if (anchorNormalized.includes(headNormalized)) return anchor;
  if (headNormalized.includes(anchorNormalized)) return head;
  return `${anchor} ${head}`.replace(/\s+/g, " ").trim();
}

function cloneCandidate(candidate: KeywordCandidate): KeywordCandidate {
  return {
    ...candidate,
    domains: new Set(candidate.domains),
    matchedItems: new Set(candidate.matchedItems),
  };
}

// ─── Slugify ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  const normalized = normalizeKeywordSurface(text);
  const hasKorean = hasHangulChars(normalized);

  if (!hasKorean) {
    const ascii = normalized
      .replace(/[^a-z0-9.\s]/g, " ")
      .replace(/\./g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (ascii.replace(/_/g, "").length >= 2) return ascii;
  }

  // 한국어 포함 텍스트 또는 너무 짧은 ASCII → 충돌 방지 해시
  let hash = 0;
  const source = normalized || text;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) >>> 0;
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
- Generic abbreviations alone: "AI", "ML", "DL", "LLM", "NLP"
- Policy, regulation, tax, GDP, market analysis
- Non-AI topics: hardware manufacturing, automotive, CCTV, construction
- Company name alone without product/event ("OpenAI", "Google", "Anthropic")
- News media outlet names ("TechCrunch", "The Verge", "Wired", "VentureBeat", "Ars Technica")
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
      matchedItems: new Set<number>(),
      latestAt: new Date(0),
      tier: "P2_RAW",
      domainBonus: 0,
      authorityOverride: 0,
    };

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      const matched = searchTerms.some((term) =>
        termMatchesHaystack(term, haystack)
      );

      if (matched) {
        candidate.matchedItems.add(idx);
        candidate.domains.add(item.sourceDomain);
        if (item.publishedAt > candidate.latestAt) {
          candidate.latestAt = item.publishedAt;
        }
        // 최고 tier 유지
        if ((TIER_ORDER[item.tier] ?? 9) < (TIER_ORDER[candidate.tier] ?? 9)) {
          candidate.tier = item.tier;
        }
        if (item.rankingSignals) {
          for (const signal of item.rankingSignals) {
            candidate.domainBonus = Math.max(
              candidate.domainBonus,
              signal.domainBonus ?? 0
            );
            candidate.authorityOverride = Math.max(
              candidate.authorityOverride,
              signal.authorityOverride ?? 0
            );
          }
        }
      }
    }

    candidate.count = candidate.matchedItems.size;
    result.set(kw.keyword.toLowerCase(), candidate);
  }

  return result;
}

// ─── Deduplication (trailing action word 병합) ──────────────────────────────

const TRAILING_ACTION_WORDS = new Set([
  "도입", "채택", "활용", "공개", "출시", "발표", "확대", "추진",
  "적용", "업데이트", "통합", "지원", "강화", "개선",
  "launch", "launched", "release", "released", "update", "updated",
  "adoption", "adopted", "integration", "integrated",
]);

function deduplicateKeywords(keywords: LLMKeyword[]): LLMKeyword[] {
  function getCore(kw: string): string {
    const words = normalizeKeywordSurface(kw).split(/\s+/).filter(Boolean);
    if (words.length >= 2 && TRAILING_ACTION_WORDS.has(words[words.length - 1])) {
      return compactKeywordSurface(words.slice(0, -1).join(" "));
    }
    return compactKeywordSurface(trimMinorVariantSuffix(words.join(" ")));
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

interface KeywordSignals {
  normalizedForms: Set<string>;
  compactForms: Set<string>;
  versionTokens: Set<string>;
  asciiCoreTokens: Set<string>;
  hasHangul: boolean;
  hasAscii: boolean;
}

function intersectsSet<T>(a: Set<T>, b: Set<T>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) return true;
  }
  return false;
}

function jaccardOverlap(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = getSetIntersectionSize(a, b);
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function buildKeywordSignals(keyword: LLMKeyword): KeywordSignals {
  const normalizedForms = new Set<string>();
  const compactForms = new Set<string>();
  const versionTokens = new Set<string>();
  const asciiCoreTokens = new Set<string>();
  let hasHangul = false;
  let hasAscii = false;

  for (const value of [keyword.keyword, ...keyword.aliases]) {
    const normalized = normalizeKeywordSurface(value);
    if (!normalized) continue;

    const trimmedVariant = trimMinorVariantSuffix(normalized);
    for (const form of [normalized, trimmedVariant]) {
      if (!form) continue;
      normalizedForms.add(form);
      const compact = compactKeywordSurface(form);
      if (compact) compactForms.add(compact);
      for (const version of extractVersionTokens(form)) {
        versionTokens.add(version);
      }
      for (const token of extractAsciiCoreTokens(form)) {
        asciiCoreTokens.add(token);
      }
    }

    if (hasHangulChars(value)) hasHangul = true;
    if (hasAsciiChars(value)) hasAscii = true;
  }

  return {
    normalizedForms,
    compactForms,
    versionTokens,
    asciiCoreTokens,
    hasHangul,
    hasAscii,
  };
}

function chooseCanonicalKeyword(
  entries: Array<{ keyword: LLMKeyword; candidate: KeywordCandidate; signals: KeywordSignals }>
): string {
  const sorted = [...entries].sort((a, b) => {
    const aNormalized = normalizeKeywordSurface(a.keyword.keyword);
    const bNormalized = normalizeKeywordSurface(b.keyword.keyword);
    const aAnchorTokens = extractAnchorLikeTokensFromKeyword(a.keyword.keyword).length;
    const bAnchorTokens = extractAnchorLikeTokensFromKeyword(b.keyword.keyword).length;
    const aContextDependent = isContextDependentKeyword(a.keyword.keyword);
    const bContextDependent = isContextDependentKeyword(b.keyword.keyword);
    const aLastWord = (() => {
      const words = aNormalized.split(/\s+/);
      return words[words.length - 1] ?? "";
    })();
    const bLastWord = (() => {
      const words = bNormalized.split(/\s+/);
      return words[words.length - 1] ?? "";
    })();

    const scoreA =
      (a.signals.hasAscii ? 40 : 0) +
      (!a.signals.hasHangul ? 10 : 0) +
      (/[a-z]\s+\d+(?:\.\d+)?/i.test(aNormalized) ? 8 : 0) +
      Math.min(aAnchorTokens, 4) * 5 +
      Math.min(a.candidate.matchedItems.size, 20) +
      (a.candidate.tier === "P0_CURATED" ? 4 : 0) -
      (aContextDependent ? 14 : 0) -
      (MINOR_VARIANT_WORDS.has(aLastWord) ? 6 : 0);
    const scoreB =
      (b.signals.hasAscii ? 40 : 0) +
      (!b.signals.hasHangul ? 10 : 0) +
      (/[a-z]\s+\d+(?:\.\d+)?/i.test(bNormalized) ? 8 : 0) +
      Math.min(bAnchorTokens, 4) * 5 +
      Math.min(b.candidate.matchedItems.size, 20) +
      (b.candidate.tier === "P0_CURATED" ? 4 : 0) -
      (bContextDependent ? 14 : 0) -
      (MINOR_VARIANT_WORDS.has(bLastWord) ? 6 : 0);

    if (scoreA !== scoreB) return scoreB - scoreA;
    if (aAnchorTokens !== bAnchorTokens) return bAnchorTokens - aAnchorTokens;
    if (aNormalized.length !== bNormalized.length) return aNormalized.length - bNormalized.length;
    return a.keyword.keyword.localeCompare(b.keyword.keyword);
  });

  return sorted[0]?.keyword.keyword ?? entries[0]?.keyword.keyword ?? "";
}

function mergeKeywordCandidates(
  canonicalText: string,
  entries: Array<{ candidate: KeywordCandidate }>
): KeywordCandidate {
  const domains = new Set<string>();
  const matchedItems = new Set<number>();
  let latestAt = new Date(0);
  let tier = "P2_RAW";

  for (const entry of entries) {
    for (const domain of entry.candidate.domains) domains.add(domain);
    for (const idx of entry.candidate.matchedItems) matchedItems.add(idx);
    if (entry.candidate.latestAt > latestAt) latestAt = entry.candidate.latestAt;
    if ((TIER_ORDER[entry.candidate.tier] ?? 9) < (TIER_ORDER[tier] ?? 9)) {
      tier = entry.candidate.tier;
    }
  }

  return {
    text: canonicalText,
    count: matchedItems.size,
    domains,
    matchedItems,
    latestAt,
    tier,
    domainBonus: Math.max(0, ...entries.map((entry) => entry.candidate.domainBonus)),
    authorityOverride: Math.max(
      0,
      ...entries.map((entry) => entry.candidate.authorityOverride)
    ),
  };
}

function shouldMergeKeywordEntries(
  left: { signals: KeywordSignals; candidate: KeywordCandidate },
  right: { signals: KeywordSignals; candidate: KeywordCandidate }
): boolean {
  if (intersectsSet(left.signals.compactForms, right.signals.compactForms)) return true;
  if (intersectsSet(left.signals.normalizedForms, right.signals.normalizedForms)) return true;

  const overlap = jaccardOverlap(left.candidate.matchedItems, right.candidate.matchedItems);
  const shareVersion = intersectsSet(left.signals.versionTokens, right.signals.versionTokens);
  const shareAsciiCore = intersectsSet(left.signals.asciiCoreTokens, right.signals.asciiCoreTokens);
  const crossScript =
    (left.signals.hasHangul && right.signals.hasAscii) ||
    (right.signals.hasHangul && left.signals.hasAscii);

  if (overlap >= 0.92 && (shareVersion || shareAsciiCore || crossScript)) return true;
  if (overlap >= 0.8 && shareVersion && (shareAsciiCore || crossScript)) return true;
  if (overlap >= 0.75 && shareAsciiCore && (shareVersion || crossScript)) return true;
  return false;
}

function normalizeAlias(alias: string): string {
  return alias.normalize("NFKC").trim();
}

function consolidateKeywordVariants(
  keywords: LLMKeyword[],
  candidateMap: Map<string, KeywordCandidate>
): { keywords: LLMKeyword[]; candidateMap: Map<string, KeywordCandidate> } {
  if (keywords.length <= 1) return { keywords, candidateMap };

  const entries = keywords.map((keyword) => ({
    keyword,
    candidate: candidateMap.get(keyword.keyword.toLowerCase()) ?? {
      text: keyword.keyword,
      count: 0,
      domains: new Set<string>(),
      matchedItems: new Set<number>(),
      latestAt: new Date(0),
      tier: "P2_RAW",
      domainBonus: 0,
      authorityOverride: 0,
    },
    signals: buildKeywordSignals(keyword),
  }));

  const parent = entries.map((_, idx) => idx);

  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]);
    return parent[index];
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (shouldMergeKeywordEntries(entries[i], entries[j])) {
        union(i, j);
      }
    }
  }

  const grouped = new Map<number, typeof entries>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    const current = grouped.get(root);
    if (current) {
      current.push(entries[i]);
    } else {
      grouped.set(root, [entries[i]]);
    }
  }

  const mergedKeywords: LLMKeyword[] = [];
  const mergedCandidates = new Map<string, KeywordCandidate>();

  for (const group of grouped.values()) {
    const canonicalKeyword = chooseCanonicalKeyword(group);
    const mergedCandidate = mergeKeywordCandidates(canonicalKeyword, group);

    const aliasByKey = new Map<string, string>();
    const canonicalKey = normalizeKeywordSurface(canonicalKeyword);
    for (const entry of group) {
      for (const alias of [entry.keyword.keyword, ...entry.keyword.aliases]) {
        const cleaned = normalizeAlias(alias);
        if (!cleaned) continue;
        const key = normalizeKeywordSurface(cleaned);
        if (!key || key === canonicalKey) continue;
        if (!aliasByKey.has(key)) aliasByKey.set(key, cleaned);
      }
    }

    const keywordItem: LLMKeyword = {
      keyword: canonicalKeyword,
      aliases: [...aliasByKey.values()],
    };

    const existing = mergedCandidates.get(canonicalKeyword.toLowerCase());
    if (existing) {
      for (const domain of mergedCandidate.domains) existing.domains.add(domain);
      for (const idx of mergedCandidate.matchedItems) existing.matchedItems.add(idx);
      existing.count = existing.matchedItems.size;
      if (mergedCandidate.latestAt > existing.latestAt) existing.latestAt = mergedCandidate.latestAt;
      if ((TIER_ORDER[mergedCandidate.tier] ?? 9) < (TIER_ORDER[existing.tier] ?? 9)) {
        existing.tier = mergedCandidate.tier;
      }
    } else {
      mergedKeywords.push(keywordItem);
      mergedCandidates.set(canonicalKeyword.toLowerCase(), mergedCandidate);
    }
  }

  return {
    keywords: mergedKeywords,
    candidateMap: mergedCandidates,
  };
}

function mergeCandidates(candidates: KeywordCandidate[], text: string): KeywordCandidate {
  const domains = new Set<string>();
  const matchedItems = new Set<number>();
  let latestAt = new Date(0);
  let tier = "P2_RAW";

  for (const candidate of candidates) {
    for (const domain of candidate.domains) domains.add(domain);
    for (const idx of candidate.matchedItems) matchedItems.add(idx);
    if (candidate.latestAt > latestAt) latestAt = candidate.latestAt;
    if ((TIER_ORDER[candidate.tier] ?? 9) < (TIER_ORDER[tier] ?? 9)) {
      tier = candidate.tier;
    }
  }

  return {
    text,
    count: matchedItems.size,
    domains,
    matchedItems,
    latestAt,
    tier,
    domainBonus: Math.max(0, ...candidates.map((candidate) => candidate.domainBonus)),
    authorityOverride: Math.max(
      0,
      ...candidates.map((candidate) => candidate.authorityOverride)
    ),
  };
}

function enrichContextDependentKeywords(
  keywords: LLMKeyword[],
  candidateMap: Map<string, KeywordCandidate>
): { keywords: LLMKeyword[]; candidateMap: Map<string, KeywordCandidate> } {
  type Entry = {
    keyword: LLMKeyword;
    candidate: KeywordCandidate;
    isContextDependent: boolean;
    anchorTokenCount: number;
  };

  const entries: Entry[] = keywords.map((keyword) => {
    const candidate = candidateMap.get(keyword.keyword.toLowerCase()) ?? {
      text: keyword.keyword,
      count: 0,
      domains: new Set<string>(),
      matchedItems: new Set<number>(),
      latestAt: new Date(0),
      tier: "P2_RAW",
      domainBonus: 0,
      authorityOverride: 0,
    };
    return {
      keyword,
      candidate: cloneCandidate(candidate),
      isContextDependent: isContextDependentKeyword(keyword.keyword),
      anchorTokenCount: extractAnchorLikeTokensFromKeyword(keyword.keyword).length,
    };
  });

  const nonContextEntries = entries.filter((entry) => !entry.isContextDependent);
  const outputKeywords = new Map<string, LLMKeyword>();
  const outputCandidates = new Map<string, KeywordCandidate>();

  const upsertOutput = (keyword: LLMKeyword, candidate: KeywordCandidate): void => {
    const key = keyword.keyword.toLowerCase();
    const existingKeyword = outputKeywords.get(key);
    const existingCandidate = outputCandidates.get(key);

    if (!existingKeyword || !existingCandidate) {
      outputKeywords.set(key, { keyword: keyword.keyword, aliases: [...new Set(keyword.aliases)] });
      outputCandidates.set(key, cloneCandidate(candidate));
      return;
    }

    existingKeyword.aliases = [...new Set([...existingKeyword.aliases, ...keyword.aliases])];
    outputCandidates.set(
      key,
      mergeCandidates([existingCandidate, candidate], existingKeyword.keyword)
    );
  };

  for (const entry of nonContextEntries) {
    upsertOutput(entry.keyword, entry.candidate);
  }

  for (const entry of entries) {
    if (!entry.isContextDependent) continue;

    let bestCompanion: Entry | null = null;
    let bestScore = -Infinity;

    for (const companion of nonContextEntries) {
      if (companion.keyword.keyword === entry.keyword.keyword) continue;
      if (companion.anchorTokenCount === 0) continue;

      const intersection = getSetIntersectionSize(
        entry.candidate.matchedItems,
        companion.candidate.matchedItems
      );
      const minIntersection = Math.max(1, Math.min(2, entry.candidate.count));
      if (intersection < minIntersection) continue;

      const overlap = jaccardOverlap(
        entry.candidate.matchedItems,
        companion.candidate.matchedItems
      );
      const overlapThreshold = entry.candidate.count <= 2 ? 0.35 : 0.45;
      if (overlap < overlapThreshold) continue;

      const score =
        overlap * 100 +
        intersection * 8 +
        Math.min(companion.candidate.domains.size, 8) * 2 +
        Math.min(companion.anchorTokenCount, 5) * 3 +
        (companion.candidate.tier === "P0_CURATED" ? 4 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestCompanion = companion;
      }
    }

    if (!bestCompanion) {
      const strongStandalone =
        entry.candidate.count >= 4 && entry.candidate.domains.size >= 3;
      if (strongStandalone) {
        upsertOutput(entry.keyword, entry.candidate);
        console.log(`[keywords] KEEP(context_head_high_signal): "${entry.keyword.keyword}"`);
      } else {
        console.log(`[keywords] DROP(context_head_no_anchor): "${entry.keyword.keyword}"`);
      }
      continue;
    }

    const enrichedText = buildContextEnrichedKeyword(
      bestCompanion.keyword.keyword,
      entry.keyword.keyword
    );
    const companionNormalized = normalizeKeywordSurface(bestCompanion.keyword.keyword);
    const headNormalized = normalizeKeywordSurface(entry.keyword.keyword);

    if (companionNormalized.includes(headNormalized)) {
      upsertOutput(
        {
          keyword: bestCompanion.keyword.keyword,
          aliases: [...bestCompanion.keyword.aliases, entry.keyword.keyword, ...entry.keyword.aliases],
        },
        mergeCandidates([bestCompanion.candidate, entry.candidate], bestCompanion.keyword.keyword)
      );
      console.log(
        `[keywords] MERGE(context_head_into_companion): "${entry.keyword.keyword}" -> "${bestCompanion.keyword.keyword}"`
      );
      continue;
    }

    const enrichedKeyword: LLMKeyword = {
      keyword: enrichedText,
      aliases: [
        ...bestCompanion.keyword.aliases,
        ...entry.keyword.aliases,
        entry.keyword.keyword,
      ],
    };
    const enrichedCandidate = mergeCandidates(
      [bestCompanion.candidate, entry.candidate],
      enrichedText
    );
    upsertOutput(enrichedKeyword, enrichedCandidate);
    console.log(
      `[keywords] ENRICH(context_head): "${entry.keyword.keyword}" + "${bestCompanion.keyword.keyword}" -> "${enrichedText}"`
    );
  }

  return {
    keywords: [...outputKeywords.values()],
    candidateMap: outputCandidates,
  };
}

function mergeNormalizedKeywordsById(items: NormalizedKeyword[]): NormalizedKeyword[] {
  const byId = new Map<string, NormalizedKeyword>();
  for (const item of items) {
    const existing = byId.get(item.keywordId);
    if (!existing) {
      byId.set(item.keywordId, {
        ...item,
        aliases: [...item.aliases],
        candidates: {
          ...item.candidates,
          domains: new Set(item.candidates.domains),
          matchedItems: new Set(item.candidates.matchedItems),
        },
      });
      continue;
    }

    const aliasSet = new Set<string>([...existing.aliases, ...item.aliases]);
    existing.aliases = [...aliasSet];

    for (const domain of item.candidates.domains) existing.candidates.domains.add(domain);
    for (const idx of item.candidates.matchedItems) existing.candidates.matchedItems.add(idx);
    existing.candidates.count = existing.candidates.matchedItems.size;
    if (item.candidates.latestAt > existing.candidates.latestAt) {
      existing.candidates.latestAt = item.candidates.latestAt;
    }
    if ((TIER_ORDER[item.candidates.tier] ?? 9) < (TIER_ORDER[existing.candidates.tier] ?? 9)) {
      existing.candidates.tier = item.candidates.tier;
    }
    existing.candidates.domainBonus = Math.max(
      existing.candidates.domainBonus,
      item.candidates.domainBonus
    );
    existing.candidates.authorityOverride = Math.max(
      existing.candidates.authorityOverride,
      item.candidates.authorityOverride
    );
  }

  return [...byId.values()];
}

// ─── Main: normalizeKeywords ────────────────────────────────────────────────

export async function normalizeKeywords(
  items: RssItem[],
  options: { mode?: PipelineMode } = {}
): Promise<NormalizedKeyword[]> {
  const mode = options.mode ?? "briefing";
  const isRealtimeMode = mode === "realtime";
  // 1. 제목 배치 준비
  const batches = prepareTitleBatches(items);
  console.log(
    `[keywords] Prepared ${batches.length} batch(es) from ${items.length} items`
  );

  // 2. LLM 키워드 추출 + 중복 병합
  const rawLlmKeywords = await extractKeywordsViaLLM(batches);
  const dedupedLlmKeywords = deduplicateKeywords(rawLlmKeywords);
  console.log(`[keywords] After dedup: ${rawLlmKeywords.length} → ${dedupedLlmKeywords.length} keywords`);

  const preConsolidationCandidates = matchKeywordsToItems(dedupedLlmKeywords, items);
  const consolidated = consolidateKeywordVariants(dedupedLlmKeywords, preConsolidationCandidates);
  console.log(
    `[keywords] After consolidate: ${dedupedLlmKeywords.length} → ${consolidated.keywords.length} keywords`
  );

  const llmKeywords = consolidated.keywords.filter((kw) => {
    if (!isExactlyExcludedKeyword(kw.keyword)) return true;
    console.log(`[keywords] DROP(exact_exclusion): "${kw.keyword}"`);
    return false;
  });
  console.log(`[keywords] After exact_exclusion: ${consolidated.keywords.length} → ${llmKeywords.length} keywords`);

  const enriched = enrichContextDependentKeywords(llmKeywords, consolidated.candidateMap);
  console.log(
    `[keywords] After context_enrich: ${llmKeywords.length} → ${enriched.keywords.length} keywords`
  );

  // 3. 아이템 매칭 → scoring 메타데이터 복원
  const candidateMap = enriched.candidateMap;

  // 4. NormalizedKeyword 배열 구성 + GENERIC_TERMS 필터
  const result: NormalizedKeyword[] = [];
  console.log(`[keywords] --- Filtering pipeline (${enriched.keywords.length} candidates) ---`);

  for (const kw of enriched.keywords) {
    const candidate = candidateMap.get(kw.keyword.toLowerCase());

    if (!candidate || candidate.count === 0) {
      console.log(`[keywords] DROP(no_match)       : "${kw.keyword}"`);
      continue;
    }
    // briefing: 단일 소스 키워드 제거(품질 우선)
    // realtime: 단일 소스 허용 폭을 넓혀 자동 키워드 소실을 방지
    const shouldDropSingleDomain = isRealtimeMode
      ? candidate.tier === "COMMUNITY" && candidate.count < 2
      : candidate.tier !== "P0_CURATED" && candidate.domains.size < 2;
    if (shouldDropSingleDomain) {
      console.log(`[keywords] DROP(single_domain)  : "${kw.keyword}" (domains=${candidate.domains.size})`);
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
    if (isMediaOutlet(kw.keyword)) {
      console.log(`[keywords] DROP(media_outlet)   : "${kw.keyword}"`);
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

  const mergedById = mergeNormalizedKeywordsById(result);
  if (mergedById.length !== result.length) {
    console.log(`[keywords] Merge by keywordId: ${result.length} → ${mergedById.length}`);
  }

  console.log(
    `[keywords] Final: ${mergedById.length} keywords after matching and filtering`
  );
  return mergedById;
}
