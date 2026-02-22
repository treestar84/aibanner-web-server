import OpenAI from "openai";
import type { TavilySource } from "./tavily";

const SYSTEM_PROMPT = `You are an AI trend analyst.
Given a keyword and its related news snippets, write a concise summary in Korean.

Rules (STRICT):
- Maximum 200 characters (Korean)
- NO emojis, NO bullet points, NO markdown
- Plain prose only
- Focus on why this keyword is trending NOW
- Be factual and specific`;

export async function generateSummary(
  keyword: string,
  sources: TavilySource[]
): Promise<string> {
  const client = new OpenAI();

  const context = sources
    .slice(0, 5)
    .map((s) => `- ${s.title}: ${s.snippet}`)
    .join("\n");

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Keyword: "${keyword}"\n\nRelated news:\n${context}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content ?? "";
    // 이모지/불릿 제거 (안전장치)
    const cleaned = raw
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
      .replace(/^[-•*]\s/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned.slice(0, 220);
  } catch (err) {
    console.warn(`[summarize] Failed for "${keyword}":`, err);
    return `${keyword} 관련 AI 트렌드가 최근 주목받고 있습니다.`;
  }
}
