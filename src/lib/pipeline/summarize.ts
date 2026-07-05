import OpenAI from "openai";
import type { TavilySource } from "./tavily";

function cleanSummary(raw: string): string {
  return raw
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/^[-•*]\s/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUMMARY_MAX_CHARS);
}

function parseTranslatedLines(raw: string): string[] {
  const normalized = raw.trim();
  if (!normalized) return [];

  const splitLines = normalized
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[\.\)\-:]\s+(?=\D)/, "").trim())
    .filter((line) => line.length > 0);

  if (splitLines.length > 1) return splitLines;

  // 모델이 한 줄에 "1. ... 2. ..." 형태로 반환하는 경우 대응
  const numbered = [...normalized.matchAll(/\d+[\.\)]\s+([^]+?)(?=\s+\d+[\.\)]\s+|$)/g)]
    .map((match) => match[1].trim())
    .filter((line) => line.length > 0);

  if (numbered.length > 0) return numbered;
  return splitLines;
}

function parseBooleanEnv(
  value: string | undefined,
  fallback = true
): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

const ENABLE_EN_SUMMARY = parseBooleanEnv(process.env.ENABLE_EN_SUMMARY, true);
const SUMMARY_CONTEXT_LIMIT = parsePositiveIntEnv(
  process.env.SUMMARY_CONTEXT_LIMIT,
  5,
  1,
  10
);
const SUMMARY_MAX_CHARS = parsePositiveIntEnv(
  process.env.SUMMARY_MAX_CHARS,
  440,
  180,
  1200
);

function buildSystemPrompt(langLabel: "Korean" | "English"): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are an AI trend analyst. Today is ${today}.
The keyword below appeared on TODAY's realtime AI trend ranking. Respond with a JSON object containing a summary and hashtag bullets in ${langLabel}.

The context lines are labeled:
- [TRIGGER]: the actual articles that put this keyword on today's ranking. These are the ground truth for WHY it is trending now.
- [BACKGROUND]: general web search results about the keyword. They may be outdated, or about a DIFFERENT product/person/project that happens to share the same name. Use them only to explain what the keyword is, and ONLY when they clearly refer to the same subject as the TRIGGER lines.

Response format (STRICT JSON, no markdown fences):
{"summary":"...","bullets":["#Tag1","#Tag2","#Tag3"]}

Rules (STRICT):
- "summary": Maximum ${SUMMARY_MAX_CHARS} characters, plain prose, NO emojis, NO bullet points, NO markdown.
  * Structure: FIRST state the concrete event or news itself (1-2 sentences, grounded in the TRIGGER lines), THEN briefly explain what the keyword is (product/category/function/concept).
  * NEVER open with meta commentary about the trend or ranking itself. Forbidden patterns include (and any variations of): "이 키워드가 트렌드에 오른 이유는", "이 키워드가 트렌드에 등장했습니다", "처음으로 등장했습니다", "오늘 주목받고 있습니다", "this keyword is trending because", "appeared on the ranking". The app UI already shows rank/new status — do not restate it. Start directly with the event: WHO did WHAT (e.g. "X가 호스팅형 MCP 서버를 출시했습니다.").
  * Ranking signals below are internal grounding context ONLY — never recite or paraphrase them in the summary.
  * If the TRIGGER lines do not clearly show a specific event, do NOT invent one — just explain the keyword itself accurately, again without any trend/ranking meta commentary.
  * NEVER blend in BACKGROUND content that describes a different entity with the same name or an unrelated past event. When TRIGGER and BACKGROUND conflict, trust TRIGGER.
  * Do NOT mention the source, feed, ranking site, community, or publication that surfaced the keyword (for example Product Hunt, Hacker News, Reddit, YouTube, GitHub Releases, or a news outlet).
  * Be factual and specific. Mention dates or timeframes only when they clarify the trending event or the keyword itself.
- "bullets": 3-5 hashtag keywords that capture the core themes (e.g. "#Regulation", "#OpenSource"). Each tag must start with #. Use ${langLabel} where natural, keep proper nouns/tech terms in original form.`;
}

interface SummaryResult {
  summary: string;
  bullets: string[];
}

interface SummariesResult {
  ko: SummaryResult;
  en: SummaryResult;
}

function parseSummaryResponse(raw: string): SummaryResult {
  const content = raw.trim();
  try {
    // Strip markdown fences if present
    const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);
    const summary = cleanSummary(typeof parsed.summary === "string" ? parsed.summary : "");
    const bullets: string[] = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((b: unknown) => typeof b === "string")
          .map((b: string) => (b.startsWith("#") ? b : `#${b}`))
          .slice(0, 5)
      : [];
    return { summary, bullets };
  } catch {
    // Fallback: treat entire response as summary, no bullets
    return { summary: cleanSummary(content), bullets: [] };
  }
}

export interface SummaryRankingSignals {
  isNew?: boolean;
  matchedArticleCount?: number;
  latestTriggerPublishedAt?: string | null;
}

export async function generateSummaries(
  keyword: string,
  sources: TavilySource[],
  rssContext: Array<{
    title: string;
    snippet: string;
    publishedAt?: string | null;
    domain?: string;
  }> = [],
  signals?: SummaryRankingSignals
): Promise<SummariesResult> {
  const client = new OpenAI();

  const triggerLines = rssContext
    .slice(0, 5)
    .filter((r) => r.title)
    .map((r) => {
      const dateTag = r.publishedAt ? `[${r.publishedAt.slice(0, 10)}] ` : "";
      const domainTag = r.domain ? ` (${r.domain})` : "";
      return `- [TRIGGER] ${dateTag}${r.title}${domainTag}${r.snippet ? `: ${r.snippet.slice(0, 200)}` : ""}`;
    });
  const backgroundLines = sources
    .slice(0, SUMMARY_CONTEXT_LIMIT)
    .map((s) => {
      const dateTag = s.publishedAt ? `[${s.publishedAt.slice(0, 10)}] ` : "";
      return `- [BACKGROUND] ${dateTag}${s.title}: ${s.snippet}`;
    });
  const context = [...triggerLines, ...backgroundLines]
    .slice(0, SUMMARY_CONTEXT_LIMIT + 5)
    .join("\n");

  const signalParts: string[] = [];
  if (signals?.isNew != null) {
    signalParts.push(
      signals.isNew
        ? "first appearance on the ranking today"
        : "already on the ranking before today"
    );
  }
  if (signals?.matchedArticleCount != null && signals.matchedArticleCount > 0) {
    signalParts.push(`${signals.matchedArticleCount} trigger article(s) matched`);
  }
  if (signals?.latestTriggerPublishedAt) {
    signalParts.push(
      `latest trigger article: ${signals.latestTriggerPublishedAt.slice(0, 10)}`
    );
  }
  const signalLine = signalParts.length > 0
    ? `\nRanking signals: ${signalParts.join("; ")}.`
    : "";

  const userMessage = `Keyword: "${keyword}"${signalLine}\n\nContext:\n${context}`;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const koPromise = client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt("Korean") },
        { role: "user", content: userMessage },
      ],
      max_tokens: 800,
      temperature: 0.3,
    });

    const enPromise = ENABLE_EN_SUMMARY
      ? client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt("English") },
            { role: "user", content: userMessage },
          ],
          max_tokens: 800,
          temperature: 0.3,
        })
      : Promise.resolve(null);

    const [koRes, enRes] = await Promise.all([koPromise, enPromise]);

    return {
      ko: parseSummaryResponse(koRes.choices[0]?.message?.content ?? ""),
      en: enRes
        ? parseSummaryResponse(enRes.choices[0]?.message?.content ?? "")
        : { summary: "", bullets: [] },
    };
  } catch (err) {
    console.warn(`[summarize] Failed for "${keyword}":`, err);
    return {
      ko: {
        summary: `${keyword} 관련 AI 트렌드가 최근 주목받고 있습니다.`,
        bullets: [],
      },
      en: {
        summary: `${keyword} is currently trending in the AI space.`,
        bullets: [],
      },
    };
  }
}

// 기존 단일 언어 함수 유지 (하위 호환)
export async function generateSummary(
  keyword: string,
  sources: TavilySource[]
): Promise<string> {
  const result = await generateSummaries(keyword, sources);
  return result.ko.summary;
}

export async function batchTranslateTitles(
  titles: string[],
  targetLang: "ko" | "en"
): Promise<string[]> {
  if (titles.length === 0) return [];
  const client = new OpenAI();

  const langLabel = targetLang === "ko" ? "Korean" : "English";
  const prompt = `Translate the following article titles to ${langLabel}.
Rules:
- Preserve technical terms, proper nouns, and brand names in their original form
- Output ONLY the translated titles, one per line, in the same order
- NO numbering, NO quotes, NO extra text

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: titles.length * 80,
      temperature: 0.1,
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const lines = parseTranslatedLines(raw);

    if (lines.length === 0) return titles;

    // 개수가 어긋나도 가능한 범위는 번역값 사용, 나머지는 원문 유지
    return titles.map((title, index) => lines[index] ?? title);
  } catch (err) {
    console.warn(`[summarize] batchTranslateTitles failed:`, err);
    return titles;
  }
}

/**
 * 키워드의 한국어 표기 방식을 분류합니다.
 * "keep"   → 영문 원문 그대로 유지 (예: Fluently, GPT-4o, GitHub Copilot)
 * "natural" → 한국어에서 이미 널리 쓰이는 표기 사용 (예: OpenAI→오픈AI, Google→구글)
 * "translate" → 일반 개념이므로 한국어 번역 (예: Open Source→오픈소스)
 */
export type KeywordLocaleAction = "keep" | "natural" | "translate";

export async function classifyKeywordType(
  keywords: string[]
): Promise<KeywordLocaleAction[]> {
  if (keywords.length === 0) return [];
  const client = new OpenAI();

  const prompt = `You are classifying AI/tech trending keywords for Korean localization.

For each keyword, decide the best Korean display strategy:
- "keep": Use the original English form as-is. For product names, brand names, services, tools, model names, or any proper noun where the English form is more recognizable to Korean tech readers. Examples: Fluently, GPT-4o, Claude, Gemini, LangChain, Hugging Face, Perplexity, Cursor, v0, Sora
- "natural": Use the commonly accepted Korean mixed form that Korean tech communities already use. Only if a well-established Korean convention exists. Examples: OpenAI→오픈AI, Google→구글, Microsoft→마이크로소프트, Open Source→오픈소스, Apple→애플
- "translate": The keyword is a general concept (not a proper noun) and should be translated to Korean. Examples: AI Regulation→AI 규제, Data Privacy→데이터 프라이버시, Chip War→칩 전쟁

IMPORTANT:
- When in doubt between "keep" and "natural", prefer "keep" — English is safer for tech terms
- Model names (Gemma, Llama, Mistral, etc.) should be "keep", NOT transliterated
- If the keyword looks like it could be a product/service name, choose "keep"
- Short branded terms or coined words (Fluently, Devin, Manus) are always "keep"

Keywords:
${keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Respond with ONLY a JSON array, same order. Example: ["keep","natural","translate"]`;

  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: keywords.length * 15,
      temperature: 0,
    });

    const raw = (res.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === keywords.length) {
      return parsed.map((v: string) => {
        if (v === "translate") return "translate";
        if (v === "natural") return "natural";
        return "keep";
      });
    }
  } catch {
    // 분류 실패 시 안전하게 keep(원문 유지) 처리
  }
  return keywords.map(() => "keep");
}

/**
 * "natural" 분류된 키워드를 한국어 커뮤니티에서 통용되는 표기로 변환합니다.
 * 예: OpenAI → 오픈AI, Google → 구글, Open Source → 오픈소스
 */
export async function naturalizeKeywordKo(
  keywords: string[]
): Promise<string[]> {
  if (keywords.length === 0) return [];
  const client = new OpenAI();

  const prompt = `Convert each English tech keyword to the commonly used Korean form in Korean tech communities.

Rules:
- Use the Korean form that Korean developers/tech readers actually use in everyday conversation
- Mix Korean and English naturally (e.g., "OpenAI" → "오픈AI", "Open Source" → "오픈소스")
- Do NOT transliterate model names or product names that are better known in English
- Output ONLY the Korean forms, one per line, in the same order
- NO numbering, NO quotes, NO extra text

Keywords:
${keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: keywords.length * 30,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const lines = parseTranslatedLines(raw);
    return keywords.map((kw, i) => lines[i] ?? kw);
  } catch (err) {
    console.warn(`[summarize] naturalizeKeywordKo failed:`, err);
    return keywords;
  }
}
