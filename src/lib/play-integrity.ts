import { JWT } from "google-auth-library";

// Google Play Integrity API 표준 검증 절차: 앱이 클라이언트에서 받은
// integrityToken을 이 함수로 서버에서 디코딩·검증한다.
//
// ⚠️ 운영 설정 주의 — PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY의 형식:
// 이 환경변수에는 **서비스 계정 JSON 키 파일의 내용 전체**를 넣어야 한다.
// (`{"type":"service_account","client_email":"...","private_key":"-----BEGIN ..."}`)
// 예전 구현은 이 값을 Authorization: Bearer 헤더에 그대로 실었지만,
// playintegrity.googleapis.com은 서비스 계정 개인키로 서명한 JWT를 교환해서
// 받은 OAuth2 access token만 받아들인다. 원문 키를 그대로 보내면 모든 요청이
// 401/403으로 떨어진다. 아직 어디에도 값이 설정된 적이 없어 마이그레이션
// 부담은 없고, 설정 안내만 이 형식으로 맞추면 된다.
const PLAY_INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";

const ACCEPTABLE_VERDICTS = ["MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"];

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

// 자격증명 파싱을 별도 함수로 분리해 둔다 — 미설정/형식오류 경로를
// 실제 Google 자격증명이나 네트워크 없이 테스트할 수 있게 하기 위해서다.
export function parseServiceAccountKey(
  raw: string | undefined,
): ServiceAccountKey {
  if (!raw || !raw.trim()) {
    throw new Error("PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY must contain the service account JSON key, not a bare token",
    );
  }

  const candidate = parsed as Partial<ServiceAccountKey> | null;
  const clientEmail = typeof candidate?.client_email === "string" ? candidate.client_email : "";
  const privateKey = typeof candidate?.private_key === "string" ? candidate.private_key : "";
  if (!clientEmail || !privateKey) {
    throw new Error(
      "PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY is missing client_email or private_key",
    );
  }

  return { client_email: clientEmail, private_key: privateKey };
}

// JWT 클라이언트는 발급받은 access token을 내부적으로 캐시하고 만료 시에만
// 다시 서명하므로, 기기 등록 요청마다 새로 만들지 않고 재사용한다.
// 키가 바뀌면(재배포 등) 캐시를 버린다.
let cachedClient: JWT | null = null;
let cachedRawKey: string | null = null;

async function getPlayIntegrityAccessToken(rawKey: string): Promise<string> {
  if (!cachedClient || cachedRawKey !== rawKey) {
    const credentials = parseServiceAccountKey(rawKey);
    cachedClient = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [PLAY_INTEGRITY_SCOPE],
    });
    cachedRawKey = rawKey;
  }

  const { token } = await cachedClient.getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain a Play Integrity OAuth2 access token");
  }
  return token;
}

export async function verifyIntegrityToken(
  integrityToken: string,
  packageName: string = "com.aitrendwidget.ai_trend_news",
): Promise<{ ok: boolean; verdict: string }> {
  // 미설정/형식오류는 여기서 throw되어 호출부(device/register)의 바깥쪽
  // try/catch가 500으로 처리한다 — 검증을 건너뛰고 통과시키지 않는다.
  const accessToken = await getPlayIntegrityAccessToken(
    process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY,
  );

  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ integrityToken }),
    },
  );
  if (!res.ok) return { ok: false, verdict: `HTTP_${res.status}` };
  const data = await res.json();
  const verdict: string = data?.tokenPayloadExternal?.deviceIntegrity?.deviceRecognitionVerdict?.[0]
    ?? "UNKNOWN";
  return { ok: ACCEPTABLE_VERDICTS.includes(verdict), verdict };
}
