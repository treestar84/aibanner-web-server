import Link from "next/link";
import {
  getActiveManualKeywordIds,
  getHotKeywords,
  getLatestSnapshotWithKeywords,
} from "@/lib/db/queries";
import { filterActiveSnapshotKeywords } from "@/lib/manual-keywords";
import styles from "./styles.module.css";

export const revalidate = 60;

const DEFAULT_LIFECYCLE_DAYS = 3;

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function resolveLifecycleDays(): number {
  return parsePositiveInt(
    process.env.RETENTION_KEYWORD_VIEW_DAYS,
    DEFAULT_LIFECYCLE_DAYS,
    1,
    30
  );
}

function formatKST(utcString: string): string {
  return new Date(utcString).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

function resolveFillRatio(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio >= 0.75) return 1;
  if (ratio >= 0.4) return 0.5;
  if (ratio >= 0.2) return 0.25;
  return 0.08;
}

export default async function BurningPage() {
  const snapshot = await getLatestSnapshotWithKeywords("realtime");

  if (!snapshot) {
    return (
      <main className={`${styles.page} min-h-screen`}>
        <section className="max-w-2xl mx-auto px-4 py-8">
          <Link
            href="/app"
            className="inline-flex items-center gap-1 text-sm text-red-200/85 hover:text-red-100 mb-6 transition-colors"
          >
            ← 트렌드 목록
          </Link>
          <div className="rounded-2xl border border-red-300/20 bg-black/35 p-6 text-center">
            <p className="text-red-100/90">아직 타는중 데이터가 없습니다.</p>
          </div>
        </section>
      </main>
    );
  }

  const lifecycleDays = resolveLifecycleDays();
  const hotKeywords = await getHotKeywords(
    lifecycleDays,
    100,
    10,
    "realtime"
  );
  const activeManualKeywordIds = await getActiveManualKeywordIds("realtime");
  const visibleHotKeywords = filterActiveSnapshotKeywords(
    hotKeywords,
    activeManualKeywordIds
  ).slice(0, 30);
  const maxViewCount = visibleHotKeywords.reduce(
    (max, item) => Math.max(max, item.view_count),
    0
  );
  const arranged = [...visibleHotKeywords].sort(
    (a, b) => stableHash(a.keyword_id) - stableHash(b.keyword_id)
  );

  return (
    <main className={`${styles.page} min-h-screen`}>
      <section className="max-w-3xl mx-auto px-4 py-8">
        <header className="mb-6">
          <Link
            href="/app"
            className="inline-flex items-center gap-1 text-sm text-red-200/85 hover:text-red-100 mb-5 transition-colors"
          >
            ← 트렌드 목록
          </Link>

          <div className={styles.banner}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-red-50">
                  타는중 키워드
                </h1>
                <p className="text-sm text-red-100/80 mt-1">
                  최근 {lifecycleDays}일 동안 realtime Top 10에 진입한 뒤 조회가 쌓인 키워드
                </p>
              </div>
              <span className={styles.fireBadge}>LIVE HEAT</span>
            </div>
            <p className="text-xs text-red-100/70 mt-4">
              업데이트: {formatKST(snapshot.updated_at_utc)} KST
            </p>
          </div>
        </header>

        {arranged.length === 0 ? (
          <div className="rounded-2xl border border-red-300/20 bg-black/35 p-6 text-center text-red-100/85">
            최근 3일 조회 데이터가 아직 없습니다.
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {arranged.map((item) => {
              const displayKeyword = item.keyword_ko || item.keyword;
              const fillRatio = resolveFillRatio(item.view_count, maxViewCount);
              const seed = stableHash(item.keyword_id);
              const jitter = seed % 8;
              const delaySeconds = (seed % 11) * 0.31;
              return (
                <Link
                  key={item.keyword_id}
                  href={`/k/${encodeURIComponent(item.keyword_id)}?from=burning`}
                  className={styles.tag}
                  style={
                    {
                      marginLeft: `${jitter}px`,
                      ["--burn-fill" as string]: `${fillRatio * 100}%`,
                      ["--burn-delay" as string]: `${delaySeconds}s`,
                    } as React.CSSProperties
                  }
                >
                  <span className={styles.tagFill} />
                  <span className={styles.tagInner}>
                    <span className={styles.metaSlot} aria-hidden>
                      <span className={styles.fireIcon}>🔥</span>
                      <span className={styles.countText}>
                        {formatCount(item.view_count)}
                      </span>
                    </span>
                    <span className={styles.keywordText}>{displayKeyword}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
