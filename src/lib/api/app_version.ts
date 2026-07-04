const DEFAULT_MIN_SUPPORTED_VERSION = "1.0.0";

/**
 * 클라이언트(Flutter 앱)가 강제 업데이트 다이얼로그를 띄우는 기준이 되는
 * 최소 지원 버전. `VIBENOW_MIN_SUPPORTED_VERSION` 환경변수로 배포 시점에
 * 조정할 수 있으며, 미설정 시 기본값을 사용한다.
 */
export function getMinSupportedVersion(): string {
  const raw = process.env.VIBENOW_MIN_SUPPORTED_VERSION;
  return raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_MIN_SUPPORTED_VERSION;
}
