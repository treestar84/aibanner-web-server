export interface LimitedFetchOptions {
  readonly headers?: HeadersInit;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 6000;

export async function readLimitedResponseText(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return null;
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readLimitedResponsePrefixText(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remainingBytes = maxBytes - receivedBytes;
    if (remainingBytes <= 0) {
      await reader.cancel();
      break;
    }
    if (value.byteLength > remainingBytes) {
      chunks.push(value.slice(0, remainingBytes));
      receivedBytes += remainingBytes;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    receivedBytes += value.byteLength;
  }

  const merged = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function fetchTextWithLimit(
  url: string,
  options: LimitedFetchOptions = {},
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: options.headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    return readLimitedResponseText(response, options.maxBytes);
  } catch (err) {
    if (err instanceof Error) return null;
    throw err;
  }
}
