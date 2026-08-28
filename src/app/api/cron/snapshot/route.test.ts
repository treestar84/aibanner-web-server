import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("cron requires a configured CRON_SECRET and a matching bearer token", () => {
  assert.match(routeSource, /if \(!cronSecret\)/);
  assert.match(routeSource, /authHeader !== `Bearer \$\{cronSecret\}`/);
  assert.match(routeSource, /status: 401/);
});

// I3: 두 배치 함수는 구현만 되어 있고 어디서도 호출되지 않아 실제로는
// 한 번도 돌지 않았다. 이 크론 라우트가 유일한 주기 실행 진입점이다.
test("cron invokes the post-survival points batch on every run", () => {
  assert.match(routeSource, /from "@\/lib\/pipeline\/tier-demotion"/);
  assert.match(routeSource, /await runPostSurvivalPointsBatch\(\)/);
  // retention 게이트 밖에서 돌아야 한다 — 하루 1회로 묶으면 24시간 생존
  // 포인트 지급이 최대 하루 늦어진다.
  const survivalIndex = routeSource.indexOf("await runPostSurvivalPointsBatch()");
  const retentionGateIndex = routeSource.indexOf("if (runRetention) {");
  assert.ok(survivalIndex > 0 && retentionGateIndex > 0);
  assert.ok(
    survivalIndex < retentionGateIndex,
    "post-survival batch must not sit behind the daily retention gate",
  );
});

test("cron invokes the tier demotion batch on the daily retention pass", () => {
  assert.match(routeSource, /await runTierDemotionBatch\(\)/);
  assert.match(
    routeSource,
    /if \(runRetention\) \{\s*\n\s*try \{\s*\n\s*tierDemotionCount = await runTierDemotionBatch\(\)/,
  );
});

test("neither community batch can take down the whole cron run", () => {
  // youtube 스텝과 같은 방식: 개별 try/catch로 감싸고 에러는 응답에 싣는다.
  assert.match(routeSource, /console\.error\("\[cron\/post-survival-points\]", batchErr\)/);
  assert.match(routeSource, /console\.error\("\[cron\/tier-demotion\]", batchErr\)/);
  assert.match(routeSource, /postSurvivalError,/);
  assert.match(routeSource, /tierDemotionError,/);
});

test("batch results are reported back in the cron response for observability", () => {
  assert.match(routeSource, /postSurvivalCount,/);
  assert.match(routeSource, /tierDemotionCount,/);
});
