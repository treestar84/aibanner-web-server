import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const dbUrl = env.match(/DATABASE_URL_UNPOOLED="([^"]+)"/)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL_UNPOOLED not found");

const sql = neon(dbUrl);

// 최근 7일 스냅샷 수
const [{ cnt, oldest }] = await sql`
  SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest
  FROM snapshots
  WHERE created_at >= NOW() - INTERVAL '7 days'
`;
console.log(`\n최근 7일 스냅샷 수: ${cnt}개 (${oldest} ~)\n`);

// 현재 Top20: 최신 스냅샷 기준, 최종점수 = total_score + policy_delta + stability_delta + manual_delta
const top20 = await sql`
  SELECT keyword,
         ROUND((total_score + policy_delta + stability_delta + manual_delta)::numeric, 4) AS final_score,
         total_score,
         policy_delta,
         stability_delta,
         source_count,
         top_source_domain,
         keyword_kind,
         version_kind
  FROM snapshot_candidates
  WHERE snapshot_id = (
    SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1
  )
  ORDER BY (total_score + policy_delta + stability_delta + manual_delta) DESC
  LIMIT 20
`;
console.log("=== 현재 최신 스냅샷 Top20 ===");
top20.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(2)}. ${r.keyword.padEnd(40)} ` +
    `score:${r.final_score}  srcs:${r.source_count}  src:${r.top_source_domain}`
  )
);

// 최근 7일 반복 등장 키워드
const rows = await sql`
  SELECT sc.keyword,
         COUNT(DISTINCT sc.snapshot_id)::int AS appearances,
         ROUND(AVG(total_score + policy_delta + stability_delta + manual_delta)::numeric, 4) AS avg_score
  FROM snapshot_candidates sc
  JOIN snapshots s ON sc.snapshot_id = s.snapshot_id
  WHERE s.created_at >= NOW() - INTERVAL '7 days'
  GROUP BY sc.keyword
  ORDER BY appearances DESC, avg_score DESC
  LIMIT 50
`;

// threshold: 스냅샷 수의 40% 이상 등장 = evergreen
const threshold = Math.max(3, Math.floor(cnt * 0.4));
const evergreen = rows.filter(r => r.appearances >= threshold);
const trending  = rows.filter(r => r.appearances < threshold);

console.log(`\n=== 반복 등장 분석 (threshold: ${threshold}회 / 전체 ${cnt}회 기준) ===`);

console.log(`\n[EVERGREEN — 제거되어야 할 키워드 (${evergreen.length}개)]`);
evergreen.forEach(r =>
  console.log(`  [${r.appearances}회] ${r.keyword}`)
);

console.log(`\n[TRENDING — 1~2회 등장, 진짜 트렌딩 후보 (상위 20개)]`);
trending.slice(0, 20).forEach(r =>
  console.log(`  [${r.appearances}회] ${r.keyword}`)
);

// 현재 Top20 vs evergreen 교차 분석
const evergreenSet = new Set(evergreen.map(r => r.keyword));
const top20Keywords = top20.map(r => r.keyword);

const shouldRemove = top20Keywords.filter(k => evergreenSet.has(k));
const wouldAdd = trending
  .filter(r => !top20Keywords.includes(r.keyword))
  .slice(0, shouldRemove.length + 3);

console.log(`\n=== 적용 시 변화 예측 ===`);
console.log(`\n[-] 현재 Top20에서 빠져야 할 키워드 (${shouldRemove.length}개):`);
shouldRemove.forEach(k => console.log(`    - ${k}`));

console.log(`\n[+] 대신 올라올 트렌딩 키워드 후보:`);
wouldAdd.forEach(r => console.log(`    + ${r.keyword}  [${r.appearances}회|score:${r.avg_score}]`));
