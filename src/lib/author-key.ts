import { createHash } from "crypto";

/**
 * 게시글 목록 응답에 실어보내는 안정적인 익명 작성자 키.
 *
 * 클라이언트(Flutter)의 로컬 "이 작성자 차단" 기능은 원래 `author_nickname`을
 * 차단 키로 썼는데, 닉네임은 전역 유일이 보장되지 않아(스키마에 유니크 제약
 * 없음) 다른 사용자가 우연히 같은 닉네임을 받으면 엉뚱한 사람이 차단되는
 * 문제가 있었다. 원본 `device_id`를 그대로 노출하면 되지만 그건 앱의 실제
 * 기기 식별자를 다른 클라이언트에게 그대로 뿌리는 셈이라, 단방향 해시의
 * 앞 12자만 잘라 보낸다 — 원본으로 되돌릴 수 없고, 같은 기기의 글은 항상
 * 같은 키를 받는다.
 */
export function authorKeyFor(deviceId: string | null | undefined): string | null {
  if (!deviceId) return null;
  return createHash("sha256").update(deviceId).digest("hex").slice(0, 12);
}
