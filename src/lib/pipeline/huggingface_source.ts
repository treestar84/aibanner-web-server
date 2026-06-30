import type { RssItem } from "./rss";

// HuggingFace Hub 트렌딩 모델 — 신규 모델 드랍 감지.
// 무인증 공개 API. trending에는 옛 모델 재부상이 섞이므로 createdAt 최근성 필터가 필수.
const HF_TRENDING_URL =
  "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50";

export interface HfModel {
  id: string; // "google/diffusiongemma-26B-A4B-it"
  createdAt?: string | null;
  likes?: number | null;
  pipeline_tag?: string | null;
}

// 공식 org의 릴리즈는 신뢰도 높은 신호로 취급 (P1_CONTEXT)
export const HF_OFFICIAL_ORGS = new Set([
  "google",
  "openai",
  "meta-llama",
  "facebook",
  "mistralai",
  "qwen",
  "deepseek-ai",
  "nvidia",
  "microsoft",
  "anthropic",
  "coherelabs",
  "cohereforai",
  "stepfun-ai",
  "bytedance",
  "bytedance-seed",
  "moonshotai",
  "zai-org",
  "ibm-granite",
  "allenai",
  "apple",
  "xai-org",
  "minimaxai",
  "baidu",
  "tencent",
  "tencent-hunyuan",
  "liquidai",
  "ideogram-ai",
  "stabilityai",
  "black-forest-labs",
  "openbmb",
]);

// 커뮤니티 개조판(uncensored 류)과 양자화 재업로드(GGUF 등)는
// 신모델이 아니거나 원본 모델과 중복이므로 제외
const HF_NOISE_RE =
  /(uncensor|abliterat|obliterat|nsfw|erotic|roleplay|gguf|awq|gptq|exl2|mlx|bnb|[48]bit|q[2-8]_)/i;

// 비공식 org 모델이 통과하려면 필요한 최소 likes
const COMMUNITY_MIN_LIKES = 50;

export function mapHfModels(
  models: readonly HfModel[],
  cutoff: Date
): RssItem[] {
  const items: RssItem[] = [];

  for (const model of models) {
    if (!model?.id || !model.id.includes("/")) continue;
    if (!model.createdAt) continue;

    const publishedAt = new Date(model.createdAt);
    if (Number.isNaN(publishedAt.getTime()) || !(publishedAt > cutoff)) continue;
    if (HF_NOISE_RE.test(model.id)) continue;

    const [org, modelName] = model.id.split("/");
    if (!org || !modelName) continue;

    const likes = model.likes ?? 0;
    const isOfficial = HF_OFFICIAL_ORGS.has(org.toLowerCase());
    if (!isOfficial && likes < COMMUNITY_MIN_LIKES) continue;

    items.push({
      title: `${org} ${modelName} — new AI model release`,
      link: `https://huggingface.co/${model.id}`,
      publishedAt,
      summary: model.pipeline_tag
        ? `New ${model.pipeline_tag} model published by ${org}.`
        : `New model published by ${org}.`,
      sourceDomain: "huggingface.co",
      feedTitle: "HuggingFace New Models",
      tier: isOfficial ? "P1_CONTEXT" : "COMMUNITY",
      lang: "en",
      engagement: { score: likes, comments: 0 },
    });
  }

  return items;
}

export async function collectHuggingFaceItems(
  windowHours = 72
): Promise<RssItem[]> {
  try {
    const res = await fetch(HF_TRENDING_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = (await res.json()) as HfModel[];

    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const items = mapHfModels(Array.isArray(models) ? models : [], cutoff);
    console.log(`[huggingface_source] ${items.length} new model(s)`);
    return items;
  } catch (err) {
    console.warn("[huggingface_source] Failed:", (err as Error).message);
    return [];
  }
}
