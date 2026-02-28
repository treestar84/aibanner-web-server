import OpenAI from "openai";
import type { TavilySource } from "./tavily";

const SYSTEM_PROMPT_KO = `You are an AI trend analyst.
Given a keyword and its related news snippets, write a concise summary in Korean.

Rules (STRICT):
- Maximum 200 characters (Korean)
- NO emojis, NO bullet points, NO markdown
- Plain prose only
- Focus on why this keyword is trending NOW
- Be factual and specific`;

const SYSTEM_PROMPT_EN = `You are an AI trend analyst.
Given a keyword and its related news snippets, write a concise summary in English.

Rules (STRICT):
- Maximum 200 characters (English)
- NO emojis, NO bullet points, NO markdown
- Plain prose only
- Focus on why this keyword is trending NOW
- Be factual and specific`;

function cleanSummary(raw: string): string {
  return raw
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/^[-•*]\s/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
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

export async function generateSummaries(
  keyword: string,
  sources: TavilySource[]
): Promise<{ ko: string; en: string }> {
  const client = new OpenAI();

  const context = sources
    .slice(0, SUMMARY_CONTEXT_LIMIT)
    .map((s) => `- ${s.title}: ${s.snippet}`)
    .join("\n");

  const userMessage = `Keyword: "${keyword}"\n\nRelated news:\n${context}`;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const koPromise = client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_KO },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const enPromise = ENABLE_EN_SUMMARY
      ? client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_EN },
            { role: "user", content: userMessage },
          ],
          max_tokens: 300,
          temperature: 0.3,
        })
      : Promise.resolve(null);

    const [koRes, enRes] = await Promise.all([koPromise, enPromise]);

    return {
      ko: cleanSummary(koRes.choices[0]?.message?.content ?? ""),
      en: enRes ? cleanSummary(enRes.choices[0]?.message?.content ?? "") : "",
    };
  } catch (err) {
    console.warn(`[summarize] Failed for "${keyword}":`, err);
    return {
      ko: `${keyword} 관련 AI 트렌드가 최근 주목받고 있습니다.`,
      en: `${keyword} is currently trending in the AI space.`,
    };
  }
}

// 기존 단일 언어 함수 유지 (하위 호환)
export async function generateSummary(
  keyword: string,
  sources: TavilySource[]
): Promise<string> {
  const result = await generateSummaries(keyword, sources);
  return result.ko;
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
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\d+\.\s*/, "").trim())
      .filter((l) => l.length > 0);

    // 길이가 맞지 않으면 원본 반환
    if (lines.length !== titles.length) return titles;
    return lines;
  } catch (err) {
    console.warn(`[summarize] batchTranslateTitles failed:`, err);
    return titles;
  }
}
