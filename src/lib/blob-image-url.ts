// 사용자 게시글의 imageUrl은 반드시 우리 업로드 엔드포인트
// (/api/v1/posts/upload-image)가 돌려준 Vercel Blob URL이어야 한다.
// 그 라우트는 MIME 타입/용량/인증을 검사하지만, POST /api/v1/posts가
// imageUrl을 그대로 받아 저장하면 그 검사를 전부 우회해 임의 외부 URL을
// 앱 피드에 심을 수 있다(외부 추적 픽셀, 혐오 이미지 핫링크 등).
//
// 허용 호스트는 추측이 아니라 실제 업로드 경로에서 유도했다:
// upload-image 라우트는 @vercel/blob의 put(..., { access: "public" })을 쓰고,
// 그 결과 URL은 `https://<storeId>.public.blob.vercel-storage.com/<pathname>`
// 형태다(@vercel/blob 자체도 내부적으로 hostname이
// ".blob.vercel-storage.com"으로 끝나는지 검사한다). 우리는 public 스토어만
// 쓰므로 한 단계 더 좁혀 ".public.blob.vercel-storage.com"을 요구한다.
const ALLOWED_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isAllowedBlobImageUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return parsed.hostname.endsWith(ALLOWED_BLOB_HOST_SUFFIX);
}
