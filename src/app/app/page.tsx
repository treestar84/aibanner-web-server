import { getLatestSnapshotWithKeywords, getTopKeywords } from "@/lib/db/queries";
import Link from "next/link";
import Image from "next/image";
import { EditorialShell } from "@/app/_components/editorial-shell";
import styles from "@/app/_components/editorial.module.css";

export const revalidate = 120; // ISR: 2분

function formatKST(utcString: string): string {
  const d = new Date(utcString);
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeltaBadge({ delta, isNew }: { delta: number; isNew: boolean }) {
  if (isNew) {
    return (
      <span className={styles.deltaNew}>
        NEW
      </span>
    );
  }
  if (delta > 0)
    return (
      <span className={styles.delta}>▲{delta}</span>
    );
  if (delta < 0)
    return (
      <span className={styles.deltaDown}>▼{Math.abs(delta)}</span>
    );
  return <span className={styles.deltaStill}>━</span>;
}

export default async function TrendsPage() {
  const snapshot = await getLatestSnapshotWithKeywords();

  if (!snapshot) {
    return (
      <EditorialShell active="trends">
        <h1 className="sr-only">AI 트렌드 실검</h1>
        <p className={styles.empty}>아직 데이터가 없습니다. 잠시 후 다시 확인해주세요.</p>
      </EditorialShell>
    );
  }

  const keywords = await getTopKeywords(snapshot.snapshot_id, 10);

  return (
    <EditorialShell active="trends">
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>THE DAILY CONTEXT</p>
          <h1>지금, AI의 흐름.</h1>
          <p className={styles.description}>빠르게 바뀌는 소식 속에서, 알아둘 맥락을 읽어보세요.</p>
        </div>
        <p className={styles.freshness}>
          <span>업데이트: {formatKST(snapshot.updated_at_utc)} KST</span>
          <span>다음 업데이트: {formatKST(snapshot.next_update_at_utc)} KST</span>
        </p>
      </header>

      <aside className={styles.editorNote}>
        <span>One keyword, many perspectives.</span>
        <p>순위는 흐름을, 출처는 맥락을 보여줍니다. 궁금한 키워드 하나에서 시작해 보세요.</p>
      </aside>

      <section aria-labelledby="keyword-list-heading">
        <div className={styles.sectionHeading}>
          <h2 id="keyword-list-heading">지금의 관심, 열 개의 키워드.</h2>
          <span>THE KEYWORD INDEX</span>
        </div>
        <ol className={styles.trendList}>
          {keywords.map((kw) => {
            const displayKeyword = kw.keyword_ko || kw.keyword;
            return (
              <li key={kw.keyword_id}>
                <Link href={`/k/${kw.keyword_id}`} className={styles.trendLink}>
                  <span className={styles.rank}>{kw.rank}</span>
                  <div className={styles.storyCopy}>
                    <div className={styles.storyHeading}>
                      <h2>{displayKeyword}</h2>
                      <DeltaBadge delta={kw.delta_rank} isNew={kw.is_new} />
                    </div>
                    <p className={styles.summary}>{kw.summary_short}</p>
                    {kw.top_source_domain && <p className={styles.domain}>{kw.top_source_domain}</p>}
                  </div>
                  {kw.top_source_image_url && (
                    <div className={styles.thumbnail}>
                      <Image
                        src={kw.top_source_image_url}
                        alt={displayKeyword}
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
      <p className={styles.snapshot}>Snapshot ID: {snapshot.snapshot_id}</p>
    </EditorialShell>
  );
}
