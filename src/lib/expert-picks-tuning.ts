import OpenAI from "openai";

/// 저작권 문제를 피하려면 원문을 다듬는(맞춤법만 교정) 수준이 아니라
/// 실제로 다른 문장·구조로 다시 써야 한다. 아래 프롬프트는:
///  - 사실관계(숫자/고유명사/날짜)만 정확히 보존하고 표현은 완전히 새로 쓰게 강제
///  - 원문과 연속 7단어 이상 겹치는 표현, 원문과 같은 문단 순서를 금지
///  - 제목도 원문 제목을 다듬은 게 아니라 새로 작성하게 해서, 본문 첫 줄에
///    제목이 그대로 남아 중복 표시되는 문제를 구조적으로 없앤다
///    (stripLeadingTitleLine 안전망은 그대로 유지하되 주된 방어선은 아님).
///  - 원문보다 뚜렷이 짧게 써서 "시장 대체 효과"(원문을 안 읽어도 되게 만드는 것) 위험을 줄임
export function buildRewritePrompt(
  titleKo: string,
  bodyKo: string,
): { system: string; user: string } {
  const system = [
    '너는 "전문가픽" 큐레이션 에디터다. 아래 원문 기사/게시물의 사실관계(숫자, 고유명사, 날짜, 인용된 발언의 취지)만 정확히 보존하고, 그 외에는 완전히 새로 써라.',
    "절대 하지 말 것: 원문 문장을 그대로 또는 단어만 살짝 바꿔 재사용(연속 7단어 이상 원문과 겹치는 표현 금지), 원문과 같은 문단 순서·문장 순서로 나열, 원문에 없는 사실이나 인용을 새로 만들어내기.",
    "반드시 할 것: 제목은 원문 제목을 베끼거나 다듬지 말고 핵심 내용을 담은 새로운 제목을 직접 작성하라. 본문은 원문보다 뚜렷이 짧게(대략 60% 이내 분량) 문단 구성과 문장 순서를 원문과 다르게 재구성하고, 전문가가 요약·해설하는 어조(예: \"~로 알려졌다\", \"~라는 분석이 나온다\")로 작성하라. 숫자·인명·날짜 등 사실 정보는 원문과 다르게 표현하지 마라.",
    '출력은 순수 JSON만: {"title": "...", "body": "..."} 다른 텍스트나 설명을 덧붙이지 마라.',
  ].join(" ");
  const user = `제목: ${titleKo}\n\n본문:\n${bodyKo}`;
  return { system, user };
}

export async function rewriteExpertPick(
  titleKo: string,
  bodyKo: string,
): Promise<{ title: string; body: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o";
  const { system, user } = buildRewritePrompt(titleKo, bodyKo);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("AI rewrite returned an empty result");
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  const title = (parsed.title ?? "").trim();
  const body = (parsed.body ?? "").trim();
  if (!title || !body) throw new Error("AI rewrite returned an incomplete result");
  return { title, body };
}

/// 커뮤니티 게시글(제목 없음, 본문만)용 다듬기. buildRewritePrompt와 달리
/// title을 다루지 않는다 — 커뮤니티 글은 애초에 제목 없이 본문만 있는
/// 데이터 모델(expert_picks.title_ko가 NULL인 author_type='user' 행)이라,
/// 제목을 새로 지어내게 하면 스키마에 없는 필드를 요구하게 된다.
export function buildCommunityRewritePrompt(
  bodyKo: string,
): { system: string; user: string } {
  const system = [
    "너는 커뮤니티 게시판 글쓰기를 돕는 다듬기 도구다. 아래 원문의 사실관계(숫자, 고유명사, 날짜, 인용된 발언의 취지)만 정확히 보존하고, 표현은 자연스럽게 다듬어라.",
    "절대 하지 말 것: 원문에 없는 사실이나 주장을 새로 만들어내기, 문체를 과도하게 격식체로 바꾸기(커뮤니티 게시글다운 캐주얼한 어조 유지).",
    "반드시 할 것: 맞춤법/띄어쓰기를 교정하고, 어색한 문장을 자연스럽게 다듬어라. 분량은 원문과 비슷하게 유지하라.",
    '출력은 순수 JSON만: {"body": "..."} 다른 텍스트나 설명을 덧붙이지 마라.',
  ].join(" ");
  return { system, user: bodyKo };
}

export async function rewriteCommunityPost(
  bodyKo: string,
): Promise<{ body: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o";
  const { system, user } = buildCommunityRewritePrompt(bodyKo);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("AI rewrite returned an empty result");
  const parsed = JSON.parse(raw) as { body?: string };
  const body = (parsed.body ?? "").trim();
  if (!body) throw new Error("AI rewrite returned an incomplete result");
  return { body };
}

export async function translateExpertPickBody(
  bodyKo: string,
): Promise<{ titleEn: string; bodyEn: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o";

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
