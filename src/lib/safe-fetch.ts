import { lookup } from "node:dns";
import { Agent, fetch as fetchWithDispatcher } from "undici";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function assertPublicAddresses(addresses: { address: string }[]): void {
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new Error("Unsafe DNS destination");
  }
}

export function publicHttpUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  ) {
    throw new Error("Unsafe external URL");
  }
  return url;
}

export async function readLimitedBody(
  response: {
    headers: { get(name: string): string | null };
    body: {
      cancel(): Promise<void>;
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<void>;
      };
    } | null;
  },
  maxBytes: number,
): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("External response exceeds limit");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("External response exceeds limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** DNS is checked inside the socket lookup, not before a second untrusted lookup.
 * Redirects are checked on every hop; the deadline includes the whole body.
 * Undici fetch decompresses bodies before readLimitedBody applies the byte cap. */
export async function safeFetchBytes(
  raw: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
    contentTypes?: string[];
  } = {},
): Promise<{ bytes: Buffer; contentType: string; url: string }> {
  let url = publicHttpUrl(raw);
  const agent = new Agent({
    connect: {
      lookup(hostname, opts, callback) {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error, "", 4);
          try {
            assertPublicAddresses(addresses);
          } catch {
            return callback(new Error("Unsafe DNS destination"), "", 4);
          }
          if (opts.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    },
  });
  const signal = AbortSignal.timeout(options.timeoutMs ?? 8000);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetchWithDispatcher(url, {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: { "User-Agent": "Vibenow/1.0", ...options.headers },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || hop === 3) throw new Error("External redirect limit");
        const next = publicHttpUrl(new URL(location, url).href);
        // Credentials are never forwarded to another origin.
        if (options.headers && next.origin !== url.origin) {
          options = {
            ...options,
            headers: Object.fromEntries(
              Object.entries(options.headers).filter(
                ([key]) =>
                  !["authorization", "cookie"].includes(key.toLowerCase()),
              ),
            ),
          };
        }
        url = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (
        options.contentTypes &&
        !options.contentTypes.some((t) =>
          contentType.toLowerCase().startsWith(t),
        )
      ) {
        await response.body?.cancel();
        throw new Error("Unexpected external content type");
      }
      return {
        bytes: await readLimitedBody(
          response,
          options.maxBytes ?? 2 * 1024 * 1024,
        ),
        contentType,
        url: url.href,
      };
    }
    throw new Error("External redirect limit");
  } finally {
    await agent.destroy();
  }
}
