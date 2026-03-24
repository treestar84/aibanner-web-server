export type PipelineMode = "realtime";

export function parsePipelineMode(
  _value?: string | null,
  _fallback?: PipelineMode
): PipelineMode {
  return "realtime";
}
