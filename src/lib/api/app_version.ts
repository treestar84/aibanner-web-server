const DEFAULT_MIN_SUPPORTED_VERSION = "1.0.0";

const SEMVER_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/**
 * 강제 업데이트 기준 버전으로 쓸 수 있는 형식인지 검증한다.
 * 잘못된 값이 클라이언트로 나가면 10만+ 사용자가 하드 블록 다이얼로그에
 * 갇힐 수 있으므로, 형식이 어긋나면 어디서든 기본값으로 폴백해야 한다.
 */
export function isValidSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value.trim());
}

/**
 * 클라이언트(Flutter 앱)가 강제 업데이트 다이얼로그를 띄우는 기준이 되는
 * 최소 지원 버전. `VIBENOW_MIN_SUPPORTED_VERSION` 환경변수로 배포 시점에
 * 조정할 수 있으며, 미설정·형식 오류 시 기본값을 사용한다.
 */
export function getMinSupportedVersion(): string {
  const raw = (process.env.VIBENOW_MIN_SUPPORTED_VERSION ?? "").trim();
  if (raw.length === 0) return DEFAULT_MIN_SUPPORTED_VERSION;
  if (!isValidSemver(raw)) {
    console.error(
      `[app_version] VIBENOW_MIN_SUPPORTED_VERSION 형식 오류("${raw}") — 기본값 ${DEFAULT_MIN_SUPPORTED_VERSION} 사용`
    );
    return DEFAULT_MIN_SUPPORTED_VERSION;
  }
  return raw;
}
