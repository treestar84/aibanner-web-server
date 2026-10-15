import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

// 관측 전용이다. 호출·재시도·선택·공개 상태를 변경하지 않는다.
const MAX_KEYWORDS = 20;
const MAX_STAGES = 24;
const MAX_LINE_BYTES = 4096;
const MAX_RUN_BYTES = 32 * 1024;
const METRICS = new Set([
  "durationMs", "inputCount", "outputCount", "missingDates", "invalidDates",
  "duplicateUrls", "newsCount", "socialCount", "dataCount", "originCount",
  "tavilyCount", "naverCount", "exaCount", "imageCount", "faviconCount",
  "defaultImageCount", "missingImages", "missingScores", "droppedCount",
  "skippedCount", "maxHttpStatus", "requestCount", "relativeImageCandidates", "cacheSnapshotAgeHours", "summaryCharsKo",
  "summaryCharsEn", "oldestSourceAgeHours", "keywordCount", "reusedCount",
]);

export type DiagnosticOutcome =
  | "ok" | "empty" | "skipped" | "disabled" | "reused" | "fallback"
  | "failure" | "quota" | "rate_limit" | "http_error" | "invalid_response"
  | "timeout" | "network_error" | "og" | "twitter" | "favicon" | "default";
const OUTCOMES = new Set<DiagnosticOutcome>([
  "ok", "empty", "skipped", "disabled", "reused", "fallback", "failure",
  "quota", "rate_limit", "http_error", "invalid_response", "timeout",
  "network_error", "og", "twitter", "favicon", "default",
]);

type Stage = { events: number; outcomes: Partial<Record<DiagnosticOutcome, number>>; metrics: Record<string, number> };
type Stats = { stages: Record<string, Stage>; metadata: Record<string, string> };
type Run = {
  id: string; snapshotId?: string; root: Stats; keywordScopes: number;
  omittedKeywords: number; emittedBytes: number; outputOmitted: boolean;
  emit: (line: string) => void;
};
const context = new AsyncLocalStorage<{ run: Run; stats: Stats; keywordId?: string }>();
const newStats = (): Stats => ({ stages: Object.create(null), metadata: Object.create(null) });
const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 20);
const reference = (value: string): string => /^[a-zA-Z0-9_-]{1,96}$/.test(value) ? value : `hash_${fingerprint(value)}`;

function emit(run: Run, data: Record<string, unknown>, final = false): void {
  try {
    let line = `[pipeline_diag] ${JSON.stringify({ schemaVersion: 1, runId: run.id, snapshotId: run.snapshotId, ...data })}`;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      line = `[pipeline_diag] ${JSON.stringify({ schemaVersion: 1, runId: run.id, snapshotId: run.snapshotId, event: data.event, keywordId: data.keywordId, outcome: data.outcome, durationMs: data.durationMs, omittedKeywords: data.omittedKeywords, detailsOmitted: true })}`;
    }
    let bytes = Buffer.byteLength(line) + 1;
    if (final && run.emittedBytes + bytes > MAX_RUN_BYTES) {
      line = `[pipeline_diag] ${JSON.stringify({ schemaVersion: 1, runId: run.id, snapshotId: run.snapshotId, event: data.event, outcome: data.outcome, durationMs: data.durationMs, omittedKeywords: data.omittedKeywords, outputOmitted: true })}`;
      bytes = Buffer.byteLength(line) + 1;
    }
    if (run.emittedBytes + bytes > (final ? MAX_RUN_BYTES : MAX_RUN_BYTES - 512)) {
      run.outputOmitted = true;
      return;
    }
    run.emittedBytes += bytes;
    run.emit(line);
  } catch {
    // 로그 출력 실패가 원래 작업의 반환값과 예외를 바꾸지 않아야 한다.
  }
}

export async function withPipelineDiagnostics<T>(
  work: () => Promise<T>,
  options: { enabled?: boolean; emit?: (line: string) => void } = {}
): Promise<T> {
  if (!(options.enabled ?? process.env.PIPELINE_DIAGNOSTICS_ENABLED === "1")) return work();
  const run: Run = {
    id: randomUUID(), root: newStats(), keywordScopes: 0, omittedKeywords: 0,
    emittedBytes: 0, outputOmitted: false,
    emit: options.emit ?? ((line) => console.info(line)),
  };
  const started = Date.now();
  let outcome: DiagnosticOutcome = "ok";
  emit(run, { event: "run_started" });
  try {
    return await context.run({ run, stats: run.root }, work);
  } catch (error) {
    outcome = "failure";
    throw error;
  } finally {
    emit(run, { event: "run_finished", outcome, durationMs: Date.now() - started,
      stages: run.root.stages, omittedKeywords: run.omittedKeywords, outputOmitted: run.outputOmitted }, true);
  }
}

export function setDiagnosticSnapshot(snapshotId: string): void {
  try { const current = context.getStore(); if (current) current.run.snapshotId = reference(snapshotId); } catch { /* 관측 실패 격리 */ }
}

export async function withKeywordDiagnostics<T>(keywordId: string, work: () => Promise<T>): Promise<T> {
  const parent = context.getStore();
  if (!parent) return work();
  if (parent.run.keywordScopes >= MAX_KEYWORDS) {
    parent.run.omittedKeywords++;
    return context.exit(work);
  }
  parent.run.keywordScopes++;
  const id = reference(keywordId);
  const stats = newStats();
  const started = Date.now();
  let outcome: DiagnosticOutcome = "ok";
  try {
    return await context.run({ run: parent.run, stats, keywordId: id }, work);
  } catch (error) {
    outcome = "failure";
    throw error;
  } finally {
    emit(parent.run, { event: "keyword_finished", keywordId: id, outcome,
      durationMs: Date.now() - started, ...stats.metadata, stages: stats.stages });
  }
}

export function recordDiagnostic(stage: string, outcome: DiagnosticOutcome, metrics: Record<string, number> = {}): void {
  try {
    const current = context.getStore();
    if (!current || !/^[a-z_]{1,40}$/.test(stage) || !OUTCOMES.has(outcome)) return;
    if (!current.stats.stages[stage] && Object.keys(current.stats.stages).length >= MAX_STAGES) return;
    const stats = current.stats.stages[stage] ??= { events: 0, outcomes: Object.create(null), metrics: Object.create(null) };
    stats.events++;
    stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1;
    for (const [key, value] of Object.entries(metrics)) {
      if (METRICS.has(key) && Number.isFinite(value) && value >= 0) {
        stats.metrics[key] = key === "maxHttpStatus" ? Math.max(stats.metrics[key] ?? 0, value)
          : Math.min(1e12, (stats.metrics[key] ?? 0) + value);
      }
    }
  } catch { /* 원래 수집 경로를 계속 진행한다. */ }
}

export function diagnosticFailure(error: unknown): DiagnosticOutcome {
  try {
    if (!error || typeof error !== "object") return "failure";
    const name = "name" in error ? String(error.name) : "";
    if (name === "SyntaxError") return "invalid_response";
    const code = "code" in error ? String(error.code) : "";
    if (["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(name) || code === "ETIMEDOUT") return "timeout";
    const status = "status" in error ? Number(error.status) : "statusCode" in error ? Number(error.statusCode) : 0;
    if (status === 429 || name === "RateLimitError") return "rate_limit";
    if (status >= 400 && status <= 599) return "http_error";
    if (["APIConnectionError", "FetchError"].includes(name) || ["ECONNRESET", "ENOTFOUND", "ECONNREFUSED"].includes(code)) return "network_error";
    return "failure";
  } catch { return "failure"; }
}

type DiagnosticSource = {
  url: string; type?: string; provider?: string | null;
  publishedAt?: string | null; published_at_utc?: string | null;
  imageUrl?: string | null; image_url?: string | null;
};

export function observeSources(sources: readonly DiagnosticSource[], summary?: string, selectedUrl?: string | null): void {
  try {
    const current = context.getStore();
    if (!current) return;
    // 기존 상세 소스 범위를 넘는 자료가 들어와도 관측 작업량을 제한한다.
    const bounded = sources.slice(0, 200);
    const metrics: Record<string, number> = { outputCount: sources.length };
    const urls: string[] = [];
    let oldest = Date.now();
    for (const source of bounded) {
      urls.push(source.url);
      const date = source.publishedAt ?? source.published_at_utc;
      if (!date) metrics.missingDates = (metrics.missingDates ?? 0) + 1;
      else if (!Number.isFinite(Date.parse(date))) metrics.invalidDates = (metrics.invalidDates ?? 0) + 1;
      else oldest = Math.min(oldest, Date.parse(date));
      if (["news", "social", "data"].includes(source.type ?? "")) {
        const key = `${source.type}Count`; metrics[key] = (metrics[key] ?? 0) + 1;
      }
      if (["origin", "tavily", "naver", "exa"].includes(source.provider ?? "")) {
        const key = `${source.provider}Count`; metrics[key] = (metrics[key] ?? 0) + 1;
      }
      const image = source.imageUrl ?? source.image_url;
      const key = !image ? "missingImages" : image.includes("default-thumbnail.png") ? "defaultImageCount" : /favicon|\.ico(?:$|[?#])/i.test(image) ? "faviconCount" : "imageCount";
      metrics[key] = (metrics[key] ?? 0) + 1;
    }
    metrics.duplicateUrls = urls.length - new Set(urls).size;
    metrics.oldestSourceAgeHours = Math.floor((Date.now() - oldest) / 3_600_000);
    recordDiagnostic("selected_sources", sources.length ? "ok" : "empty", metrics);
    current.stats.metadata.sourceSetHash = fingerprint(JSON.stringify([...new Set(urls)].sort()));
    if (summary !== undefined) current.stats.metadata.summaryHash = fingerprint(summary.slice(0, 4096));
    if (selectedUrl) current.stats.metadata.topSourceHash = fingerprint(selectedUrl);
  } catch { /* 소스 관측은 선택된 결과를 변경하지 않는다. */ }
}
