import { tavily } from "@tavily/core";

export type TavilyFailureKind = "quota" | "rate_limit" | "other";

interface TavilyKeyState {
  readonly disabledUntilMs: number;
  readonly reason: TavilyFailureKind;
  readonly failureCount: number;
}

interface TavilySearchResult {
  readonly title: string;
  readonly url: string;
  readonly content?: string;
  readonly publishedDate?: string;
}

const tavilyKeyStates = new Map<string, TavilyKeyState>();

type TavilyClient = ReturnType<typeof tavily>;

export function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export function resolveTavilyApiKeys(
  env?: { readonly TAVILY_API_KEY?: string; readonly TAVILY_API_KEYS?: string }
): string[] {
  const source = env ?? {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    TAVILY_API_KEYS: process.env.TAVILY_API_KEYS,
  };
  const keys = [
    ...splitEnvList(source.TAVILY_API_KEY),
    ...splitEnvList(source.TAVILY_API_KEYS),
  ];
  return Array.from(new Set(keys));
}

export function classifyTavilyFailure(error: unknown): TavilyFailureKind {
  const status = getErrorField(error, "status") ?? getErrorField(error, "statusCode");
  const code = String(getErrorField(error, "code") ?? "").toLowerCase();
  const name = String(getErrorField(error, "name") ?? "").toLowerCase();
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(getErrorField(error, "message") ?? error ?? "").toLowerCase();
  const combined = `${code} ${name} ${message}`;

  if (
    combined.includes("quota") ||
    combined.includes("credit") ||
    combined.includes("billing") ||
    combined.includes("insufficient") ||
    combined.includes("exceeded")
  ) {
    return "quota";
  }
  if (
    Number(status) === 429 ||
    combined.includes("rate limit") ||
    combined.includes("ratelimit") ||
    combined.includes("too many requests") ||
    combined.includes("throttle")
  ) {
    return "rate_limit";
  }
  return "other";
}

export async function fetchTavilySearch(
  query: string,
  options: { readonly maxResults: number; readonly timeRange: "day" | "week" | "month" },
  cooldown: { readonly maxKeyAttempts: number; readonly rateLimitMinutes: number; readonly quotaHours: number }
): Promise<readonly TavilySearchResult[]> {
  const attempts = getTavilyKeyAttempts(cooldown.maxKeyAttempts);
  if (attempts.length === 0) return [];

  for (const { apiKey, client } of attempts) {
    try {
      const res = await client.search(query, {
        searchDepth: "basic",
        maxResults: options.maxResults,
        timeRange: options.timeRange,
        includeImages: false,
      });
      return res.results;
    } catch (error) {
      const failureKind = classifyTavilyFailure(error);
      if (failureKind !== "quota" && failureKind !== "rate_limit") {
        console.warn(`[tavily] Search failed for query "${query}": ${errorMessage(error)}`);
        return [];
      }

      markTavilyKeyFailure(apiKey, failureKind, cooldown);
      console.warn(
        `[tavily] ${failureKind} for key ${maskTavilyKey(apiKey)}; trying fallback key if available.`
      );
    }
  }

  console.warn(`[tavily] All available Tavily keys failed for query "${query}".`);
  return [];
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function maskTavilyKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function getErrorField(error: unknown, key: string): unknown {
  if (error && typeof error === "object" && key in error) {
    return Reflect.get(error, key);
  }
  return undefined;
}

function getTavilyCooldownMs(
  kind: TavilyFailureKind,
  cooldown: { readonly rateLimitMinutes: number; readonly quotaHours: number }
): number {
  if (kind === "quota") return cooldown.quotaHours * 60 * 60 * 1000;
  if (kind === "rate_limit") return cooldown.rateLimitMinutes * 60 * 1000;
  return 0;
}

function markTavilyKeyFailure(
  apiKey: string,
  kind: TavilyFailureKind,
  cooldown: { readonly rateLimitMinutes: number; readonly quotaHours: number }
): void {
  const cooldownMs = getTavilyCooldownMs(kind, cooldown);
  if (cooldownMs <= 0) return;

  const previous = tavilyKeyStates.get(apiKey);
  tavilyKeyStates.set(apiKey, {
    disabledUntilMs: Date.now() + cooldownMs,
    reason: kind,
    failureCount: (previous?.failureCount ?? 0) + 1,
  });
}

function isTavilyKeyAvailable(apiKey: string): boolean {
  const state = tavilyKeyStates.get(apiKey);
  if (!state) return true;
  if (Date.now() >= state.disabledUntilMs) {
    tavilyKeyStates.delete(apiKey);
    return true;
  }
  return false;
}

function getTavilyKeyAttempts(
  maxKeyAttempts: number
): Array<{ readonly apiKey: string; readonly client: TavilyClient }> {
  const keys = resolveTavilyApiKeys().filter(isTavilyKeyAvailable);
  return keys.slice(0, maxKeyAttempts).map((apiKey) => ({
    apiKey,
    client: tavily({ apiKey }),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
