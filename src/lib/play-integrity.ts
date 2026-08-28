// Google Play Integrity API 표준 검증 절차: 앱이 클라이언트에서 받은
// integrityToken을 이 함수로 서버에서 디코딩·검증한다. 실제 호출은
// googleapis 패키지의 playintegrity.v1.decodeIntegrityToken을 쓰되,
// 여기서는 fetch 기반 REST 호출로 의존성을 최소화한다.
const ACCEPTABLE_VERDICTS = ["MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"];

export async function verifyIntegrityToken(
  integrityToken: string,
  packageName: string = "com.aitrendwidget.ai_trend_news",
): Promise<{ ok: boolean; verdict: string }> {
  const apiKey = process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY;
  if (!apiKey) throw new Error("PLAY_INTEGRITY_SERVICE_ACCOUNT_KEY is not configured");

  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrityToken }),
    },
  );
  if (!res.ok) return { ok: false, verdict: `HTTP_${res.status}` };
  const data = await res.json();
  const verdict: string = data?.tokenPayloadExternal?.deviceIntegrity?.deviceRecognitionVerdict?.[0]
    ?? "UNKNOWN";
  return { ok: ACCEPTABLE_VERDICTS.includes(verdict), verdict };
}
