import Parser from "rss-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RSS_FEEDS, type RssFeedConfig } from "../src/lib/pipeline/rss";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RECENT_HOURS = 72;
const DEFAULT_STALE_HOURS = 14 * 24;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  "Accept-Language": "ko,en;q=0.9",
};

export type HealthStatus =
  | "healthy"
  | "no_recent"
  | "stale"
  | "undated"
  | "empty"
  | "http_failure"
  | "parse_failure";

export interface HealthClassificationInput {
  totalItems: number;
  datedItems: number;
  missingDateItems: number;
  invalidDateItems: number;
  latestAgeHours: number | null;
  recentItems: number;
  staleHours: number;
}

export interface HealthClassification {
  status: Exclude<HealthStatus, "http_failure" | "parse_failure">;
  severity: "ok" | "warning";
  reasons: string[];
}

interface FeedHealthResult extends HealthClassificationInput {
  title: string;
  url: string;
  tier: RssFeedConfig["tier"];
  status: HealthStatus;
  severity: "ok" | "warning" | "failure";
  reasons: string[];
  httpStatus: number | null;
  latestPublishedAt: string | null;
  durationMs: number;
  sanitized: boolean;
  error: string | null;
}

interface Options {
  concurrency: number;
  timeoutMs: number;
  recentHours: number;
  staleHours: number;
  json: boolean;
}

export function classifyFeedHealth(
  input: HealthClassificationInput
): HealthClassification {
  const reasons: string[] = [];

  if (input.totalItems === 0) {
    return { status: "empty", severity: "warning", reasons: ["피드 항목 없음"] };
  }

  if (input.datedItems === 0) {
    return {
      status: "undated",
      severity: "warning",
      reasons: ["유효한 발행일이 있는 항목 없음"],
    };
  }

  if (input.missingDateItems > 0) {
    reasons.push(`발행일 누락 ${input.missingDateItems}건`);
  }
  if (input.invalidDateItems > 0) {
    reasons.push(`잘못된 발행일 ${input.invalidDateItems}건`);
  }

  if (input.latestAgeHours !== null && input.latestAgeHours > input.staleHours) {
    reasons.unshift(`최신 글이 stale 기준 ${input.staleHours}시간을 초과`);
    return { status: "stale", severity: "warning", reasons };
  }

  if (input.recentItems === 0) {
    reasons.unshift("최근 관찰 구간에 새 글 없음(피드는 정상)");
    return { status: "no_recent", severity: "warning", reasons };
  }

  return {
    status: "healthy",
    severity: reasons.length > 0 ? "warning" : "ok",
    reasons,
  };
}

function sanitizeXml(xml: string): string {
  const placeholders: string[] = [];
  const masked = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => {
    placeholders.push(match);
    return `__CDATA_${placeholders.length - 1}__`;
  });
  const fixed = masked.replace(
    /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g,
    "&amp;"
  );
  return fixed.replace(/__CDATA_(\d+)__/g, (_, index: string) =>
    placeholders[Number(index)]
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureResult(
  feed: RssFeedConfig,
  startedAt: number,
  status: "http_failure" | "parse_failure",
  error: unknown,
  httpStatus: number | null,
  staleHours: number
): FeedHealthResult {
  return {
    title: feed.title,
    url: feed.url,
    tier: feed.tier,
    status,
    severity: "failure",
    reasons: [errorMessage(error)],
    httpStatus,
    totalItems: 0,
    datedItems: 0,
    missingDateItems: 0,
    invalidDateItems: 0,
    latestPublishedAt: null,
    latestAgeHours: null,
    recentItems: 0,
    staleHours,
    durationMs: Date.now() - startedAt,
    sanitized: false,
    error: errorMessage(error),
  };
}

async function inspectFeed(
  feed: RssFeedConfig,
  options: Options,
  now: Date
): Promise<FeedHealthResult> {
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(feed.url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    return failureResult(
      feed,
      startedAt,
      "http_failure",
      error,
      null,
      options.staleHours
    );
  }

  if (!response.ok) {
    return failureResult(
      feed,
      startedAt,
      "http_failure",
      new Error(`HTTP ${response.status} ${response.statusText}`.trim()),
      response.status,
      options.staleHours
    );
  }

  let xml: string;
  try {
    xml = await response.text();
  } catch (error) {
    return failureResult(
      feed,
      startedAt,
      "http_failure",
      error,
      response.status,
      options.staleHours
    );
  }

  const parser = new Parser();
  let parsed: Awaited<ReturnType<typeof parser.parseString>>;
  let sanitized = false;
  try {
    parsed = await parser.parseString(xml);
  } catch (firstError) {
    try {
      parsed = await parser.parseString(sanitizeXml(xml));
      sanitized = true;
    } catch {
      return failureResult(
        feed,
        startedAt,
        "parse_failure",
        firstError,
        response.status,
        options.staleHours
      );
    }
  }

  let missingDateItems = 0;
  let invalidDateItems = 0;
  const dates: Date[] = [];

  for (const item of parsed.items ?? []) {
    const rawDate = item.pubDate ?? item.isoDate;
    if (!rawDate) {
      missingDateItems += 1;
      continue;
    }
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) {
      invalidDateItems += 1;
      continue;
    }
    dates.push(date);
  }

  dates.sort((a, b) => b.getTime() - a.getTime());
  const latest = dates[0] ?? null;
  const latestAgeHours = latest
    ? Math.max(0, (now.getTime() - latest.getTime()) / 3_600_000)
    : null;
  const recentCutoff = now.getTime() - options.recentHours * 3_600_000;
  const recentItems = dates.filter((date) => date.getTime() >= recentCutoff).length;
  const input: HealthClassificationInput = {
    totalItems: parsed.items?.length ?? 0,
    datedItems: dates.length,
    missingDateItems,
    invalidDateItems,
    latestAgeHours,
    recentItems,
    staleHours: options.staleHours,
  };
  const classification = classifyFeedHealth(input);

  return {
    title: feed.title,
    url: feed.url,
    tier: feed.tier,
    ...input,
    ...classification,
    httpStatus: response.status,
    latestPublishedAt: latest?.toISOString() ?? null,
    durationMs: Date.now() - startedAt,
    sanitized,
    error: null,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function positiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag}에는 0보다 큰 숫자가 필요합니다.`);
  }
  return parsed;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    recentHours: DEFAULT_RECENT_HOURS,
    staleHours: DEFAULT_STALE_HOURS,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--concurrency") {
      const concurrency = positiveNumber(args[++index], arg);
      if (!Number.isInteger(concurrency)) {
        throw new Error(`${arg}에는 양의 정수가 필요합니다.`);
      }
      options.concurrency = concurrency;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = positiveNumber(args[++index], arg);
    } else if (arg === "--recent-hours") {
      options.recentHours = positiveNumber(args[++index], arg);
    } else if (arg === "--stale-hours") {
      options.staleHours = positiveNumber(args[++index], arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run health:sources -- [--json] [--concurrency 4] " +
          "[--timeout-ms 8000] [--recent-hours 72] [--stale-hours 336]"
      );
      process.exit(0);
    } else {
      throw new Error(`알 수 없는 옵션: ${arg}`);
    }
  }

  if (options.staleHours < options.recentHours) {
    throw new Error("--stale-hours는 --recent-hours 이상이어야 합니다.");
  }
  return options;
}

function formatAge(hours: number | null): string {
  if (hours === null) return "-";
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function printHuman(results: FeedHealthResult[], options: Options, checkedAt: Date): void {
  console.log(
    `RSS source health (${checkedAt.toISOString()}) — recent=${options.recentHours}h, ` +
      `stale=${options.staleHours}h, timeout=${options.timeoutMs}ms, concurrency=${options.concurrency}`
  );
  console.log("STATUS        ITEMS DATED MISS RECENT LATEST      AGE     MS  SOURCE");
  for (const result of results) {
    const latest = result.latestPublishedAt?.slice(0, 10) ?? "-";
    console.log(
      `${result.status.padEnd(13)} ${String(result.totalItems).padStart(5)} ` +
        `${String(result.datedItems).padStart(5)} ${String(result.missingDateItems).padStart(4)} ` +
        `${String(result.recentItems).padStart(6)} ${latest.padEnd(11)} ` +
        `${formatAge(result.latestAgeHours).padStart(6)} ` +
        `${String(result.durationMs).padStart(6)}  ${result.title}`
    );
    if (result.severity !== "ok") {
      console.log(`  ${result.url} — ${result.reasons.join("; ")}`);
    }
  }

  const failures = results.filter((result) => result.severity === "failure").length;
  const warnings = results.filter((result) => result.severity === "warning").length;
  const healthy = results.length - failures - warnings;
  console.log(
    `Summary: total=${results.length} healthy=${healthy} warnings=${warnings} failures=${failures}`
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const checkedAt = new Date();
  const results = await mapWithConcurrency(
    RSS_FEEDS,
    options.concurrency,
    (feed) => inspectFeed(feed, options, checkedAt)
  );
  const failures = results.filter((result) => result.severity === "failure").length;
  const warnings = results.filter((result) => result.severity === "warning").length;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          checkedAt: checkedAt.toISOString(),
          options,
          summary: {
            total: results.length,
            healthy: results.length - failures - warnings,
            warnings,
            failures,
          },
          feeds: results,
        },
        null,
        2
      )
    );
  } else {
    printHuman(results, options, checkedAt);
  }

  process.exitCode = failures > 0 ? 1 : 0;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMain) {
  main().catch((error) => {
    console.error(`[source-health] ${errorMessage(error)}`);
    process.exitCode = 2;
  });
}
