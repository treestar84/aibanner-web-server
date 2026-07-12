import { NextRequest, NextResponse } from "next/server";

const ADMIN_DEFAULT_USER = "admin";
const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_HASH_BYTES = 32;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

async function pbkdf2Hex(
  password: string,
  salt: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations,
    },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return toHex(bits);
}

function normalizeEnvValue(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  const hasDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const hasSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (hasDoubleQuotes || hasSingleQuotes) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export async function hashAdminPassword(
  password: string,
  salt: string
): Promise<string> {
  const hash = await pbkdf2Hex(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hash}`;
}

export function isAdminAuthConfigured(): boolean {
  const salt = normalizeEnvValue(process.env.ADMIN_PASSWORD_SALT);
  const hash = normalizeEnvValue(process.env.ADMIN_PASSWORD_HASH);
  return Boolean(salt && hash);
}

export async function verifyAdminBasicAuth(
  authorizationHeader: string | null
): Promise<boolean> {
  const expectedUser =
    normalizeEnvValue(process.env.ADMIN_BASIC_USER) || ADMIN_DEFAULT_USER;
  const expectedHash = normalizeEnvValue(process.env.ADMIN_PASSWORD_HASH).toLowerCase();
  const salt = normalizeEnvValue(process.env.ADMIN_PASSWORD_SALT);

  if (!expectedHash || !salt) return false;
  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
    return false;
  }

  let decoded = "";
  try {
    decoded = atob(authorizationHeader.slice(6));
  } catch {
    return false;
  }

  const splitIndex = decoded.indexOf(":");
  if (splitIndex <= 0) return false;

  const user = decoded.slice(0, splitIndex);
  const password = decoded.slice(splitIndex + 1);
  if (!safeEqual(user, expectedUser)) return false;

  const pbkdf2Match = expectedHash.match(/^pbkdf2\$(\d+)\$([a-f0-9]{64})$/);
  if (pbkdf2Match) {
    const iterations = Number.parseInt(pbkdf2Match[1], 10);
    if (!Number.isFinite(iterations) || iterations < 100_000) return false;
    const actualHash = await pbkdf2Hex(password, salt, iterations);
    return safeEqual(actualHash, pbkdf2Match[2]);
  }

  // 기존 SHA-256 환경변수를 즉시 무효화하지 않기 위한 호환 경로다.
  // 다음 배포 전에 `npm run admin:hash`로 PBKDF2 해시로 교체해야 한다.
  const legacyHash = await sha256Hex(`${salt}:${password}`);
  return safeEqual(legacyHash, expectedHash);
}

export function adminUnauthorizedResponse(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Admin Area", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Middleware 우회 취약점이 재발해도 API route 자체에서 권한을 확인한다.
 */
export async function requireAdminRequest(
  request: NextRequest,
): Promise<NextResponse | null> {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: "ADMIN auth is not configured on server" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const authorized = await verifyAdminBasicAuth(
    request.headers.get("authorization"),
  );
  return authorized ? null : adminUnauthorizedResponse();
}
