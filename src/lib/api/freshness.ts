import type { PipelineMode } from "@/lib/pipeline/mode";

export function buildFreshness(updatedAtUtc: string) {
  const generatedAt = new Date().toISOString();
  const updatedMs = new Date(updatedAtUtc).getTime();
  const generatedMs = new Date(generatedAt).getTime();
  const ingestionLagSec = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((generatedMs - updatedMs) / 1000))
    : null;

  return {
    generatedAt,
    ingestionLagSec,
  };
}

export function cacheControlByMode(_mode: PipelineMode, route: "top" | "hot" | "meta" | "search"): string {
  if (route === "search") {
    // search는 사용자 쿼리마다 다른 응답(Tavily 폴백 포함)이라 캐시 적중률이
    // 낮고, 이미 30초로 배포·검증됨(Vercel Edge에서 HIT 확인됨) — 건드리지
    // 않는다.
    return "public, s-maxage=30, stale-while-revalidate=15";
  }

  // top/hot/meta는 하루 4회(cron_realtime.yml: 09:10/11:10/13:10/15:10 KST,
  // 2시간 간격)만 실제로 값이 바뀐다. 이전엔 여기도 30초였는데, 위젯
  // 백그라운드 동기화가 하루 12회 이상 돌면서 대부분 캐시를 못 타고 매번
  // 오리진(함수+DB)을 때리는 원인이었다.
  //
  // 5분으로 늘려도 "틀린 데이터를 보여주는" 위험은 없다(어차피 2시간 동안은
  // 값이 그대로이므로) — 유일한 리스크는 새 스냅샷이 반영된 후 그 사실이
  // 퍼지는 데 걸리는 지연이다. 2026-09-13 기준 일부러 보수적으로 짧게
  // 잡았다: 5분 s-maxage + 1분 stale-while-revalidate ⇒ 최악의 경우에도
  // 새 스냅샷 이후 최대 6분 안에 모든 요청이 새 값을 받는다. 이는 2시간
  // 갱신 주기 대비 5% 미만이라 "갱신 주기를 건너뛴다"는 우려가 구조적으로
  // 발생할 수 없는 크기다. 이후 실측(오리진 호출 감소 폭)을 보고 필요하면
  // 더 늘리되, 늘릴 때도 항상 2시간 간격의 한 자릿수 % 이내로 유지할 것.
  return "public, s-maxage=300, stale-while-revalidate=60";
}
