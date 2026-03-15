const ADMIN_DEFAULT_USER = "admin";

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
  return sha256Hex(`${salt}:${password}`);
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

  const actualHash = await hashAdminPassword(password, salt);
  return safeEqual(actualHash, expectedHash);
}
