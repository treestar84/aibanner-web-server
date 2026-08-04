// 클라이언트 텔레메트리(에러 리포트/애널리틱스 이벤트) 페이로드 검증·정규화.
// 공개 엔드포인트로 들어오는 임의 입력이므로 모든 필드를 화이트리스트 방식으로
// 잘라내고, 초과분은 조용히 버린다 (악성/비정상 클라이언트가 4xx 재시도 루프를
// 돌지 않도록 관대하게 수용하되 저장량은 서버가 통제).

export const MAX_ERRORS_PER_BATCH = 20;
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_STACK_LENGTH = 8000;
export const MAX_ERROR_COUNT = 1000;
export const MAX_EVENT_COUNT = 10_000;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const EVENT_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function cleanShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

export interface ClientMeta {
  clientId: string;
  appVersion: string;
  platform: string;
  osVersion: string;
  deviceModel: string;
}

export function parseClientMeta(body: unknown): ClientMeta | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const clientId = typeof record.clientId === "string" ? record.clientId.trim() : "";
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  return {
    clientId,
    appVersion: cleanShortText(record.appVersion, 32),
    platform: cleanShortText(record.platform, 16).toLowerCase(),
    osVersion: cleanShortText(record.osVersion, 32),
    deviceModel: cleanShortText(record.deviceModel, 64),
  };
}

export interface ClientErrorItem {
  fingerprint: string;
  message: string;
  stack: string;
  isFatal: boolean;
  count: number;
}

export function parseErrorItems(value: unknown): ClientErrorItem[] {
  if (!Array.isArray(value)) return [];
  const items: ClientErrorItem[] = [];
  for (const raw of value.slice(0, MAX_ERRORS_PER_BATCH)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const fingerprint =
      typeof record.fingerprint === "string" ? record.fingerprint.trim() : "";
    if (!FINGERPRINT_PATTERN.test(fingerprint)) continue;
    const message = cleanShortText(record.message, MAX_MESSAGE_LENGTH);
    if (message.length === 0) continue;
    const count =
      typeof record.count === "number" && Number.isFinite(record.count)
        ? Math.min(MAX_ERROR_COUNT, Math.max(1, Math.floor(record.count)))
        : 1;
    items.push({
      fingerprint,
      message,
      stack:
        typeof record.stack === "string"
          ? record.stack.slice(0, MAX_STACK_LENGTH)
          : "",
      isFatal: record.isFatal === true,
      count,
    });
  }
  return items;
}

export interface AnalyticsEventItem {
  name: string;
  count: number;
}

export function parseEventItems(value: unknown): AnalyticsEventItem[] {
  if (!Array.isArray(value)) return [];
  const merged = new Map<string, number>();
  for (const raw of value.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!EVENT_NAME_PATTERN.test(name)) continue;
    const count =
      typeof record.count === "number" && Number.isFinite(record.count)
        ? Math.min(MAX_EVENT_COUNT, Math.max(1, Math.floor(record.count)))
        : 1;
    merged.set(name, Math.min(MAX_EVENT_COUNT, (merged.get(name) ?? 0) + count));
  }
  return [...merged.entries()].map(([name, count]) => ({ name, count }));
}
