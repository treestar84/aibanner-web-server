export type PipelineMode = "realtime" | "briefing";

const PIPELINE_MODE_SET = new Set<PipelineMode>(["realtime", "briefing"]);

export function parsePipelineMode(
  value: string | null | undefined,
  fallback: PipelineMode = "briefing"
): PipelineMode {
  const normalized = (value ?? "").trim().toLowerCase();
  if (PIPELINE_MODE_SET.has(normalized as PipelineMode)) {
    return normalized as PipelineMode;
  }
  return fallback;
}
