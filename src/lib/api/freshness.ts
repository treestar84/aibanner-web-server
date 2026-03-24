import type { PipelineMode } from "@/lib/pipeline/mode";

export function buildFreshness(updatedAtUtc: string) {
  const generatedAt = new Date().toISOString();
  const updatedMs = new Date(updatedAtUtc).getTime();
  const generatedMs = new Date(generatedAt).getTime();
  const ingestionLagSec = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((generatedMs - updatedMs) / 1000))
    : null;

  return {
    generatedAt,
    ingestionLagSec,
  };
}

export function cacheControlByMode(_mode: PipelineMode, _route: "top" | "hot" | "meta"): string {
  return "public, s-maxage=30, stale-while-revalidate=15";
}
