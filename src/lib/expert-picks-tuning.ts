import OpenAI from "openai";

export function buildTuningPrompt(bodyKo: string): { system: string; user: string } {
  const system = [
    "너는 한국어 편집자다. 아래 원문의 사실관계(fact)와 의미는 절대 바꾸지 마라.",
    "맞춤법, 띄어쓰기, 문장부호만 정리하고 카카오톡 특유의 줄임말·이모지 남발만 다듬어라.",
    "문단 구성(줄바꿈)은 원문 그대로 유지하라. 새로운 문장을 추가하거나 내용을 요약하지 마라.",
    "결과는 다듬어진 본문 텍스트만 출력하라. 설명이나 따옴표를 덧붙이지 마라.",
  ].join(" ");
  const user = bodyKo;
  return { system, user };
}

export async function tuneExpertPickBody(
  bodyKo: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const { system, user } = buildTuningPrompt(bodyKo);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  const tuned = completion.choices[0]?.message?.content?.trim();
  if (!tuned) throw new Error("AI tuning returned an empty result");
  return tuned;
}

export async function translateExpertPickBody(
  bodyKo: string,
): Promise<{ titleEn: string; bodyEn: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Translate the given Korean text to natural English, preserving paragraph breaks exactly. " +
          "Output strict JSON: {\"title\": \"...\", \"body\": \"...\"} with no other text.",
      },
      { role: "user", content: bodyKo },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("Translation returned an empty result");
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  return { titleEn: parsed.title ?? "", bodyEn: parsed.body ?? "" };
}
