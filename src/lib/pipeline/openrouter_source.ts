import type { RssItem } from "./rss";

// OpenRouter 모델 카탈로그 — 상용 API 신모델 등록을 당일 감지한다.
// 무인증 공개 API. 노이즈 없음(공식 등록만 존재).
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModel {
  id: string;
  name?: string | null;
  created?: number | null;
  context_length?: number | null;
}

// ":free", ":extended" 같은 variant는 base 모델과 같은 릴리즈이므로 병합
function baseModelId(id: string): string {
  return id.split(":")[0];
}

export function mapOpenRouterModels(
  models: readonly OpenRouterModel[],
  cutoff: Date
): RssItem[] {
  const seen = new Set<string>();
  const items: RssItem[] = [];

  for (const model of models) {
    if (!model?.id || typeof model.created !== "number") continue;
    // "~vendor/alias" 형태의 라우팅 alias는 실제 신모델이 아님
    if (!/^[a-z0-9]/i.test(model.id)) continue;

    const publishedAt = new Date(model.created * 1000);
    if (!(publishedAt > cutoff)) continue;

    const base = baseModelId(model.id);
    if (seen.has(base)) continue;
    seen.add(base);

    const name = (model.name ?? base).replace(/\s*\(free\)\s*$/i, "").trim();
    if (!name) continue;
    const contextLength = model.context_length ?? 0;

    items.push({
      title: `${name} — new model now available via API`,
      link: `https://openrouter.ai/${base}`,
      publishedAt,
      summary:
        contextLength > 0
          ? `New model API listing with ${Math.round(contextLength / 1000)}K context window.`
          : "New model API listing.",
      sourceDomain: "openrouter.ai",
      feedTitle: "OpenRouter New Models",
      tier: "P1_CONTEXT",
      lang: "en",
    });
  }

  return items;
}

export async function collectOpenRouterItems(
  windowHours = 72
): Promise<RssItem[]> {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: OpenRouterModel[] };

    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const items = mapOpenRouterModels(data.data ?? [], cutoff);
    console.log(`[openrouter_source] ${items.length} new model(s)`);
    return items;
  } catch (err) {
    console.warn("[openrouter_source] Failed:", (err as Error).message);
    return [];
  }
}
