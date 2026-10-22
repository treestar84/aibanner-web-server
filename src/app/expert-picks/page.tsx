import Link from "next/link";
import { EditorialShell } from "@/app/_components/editorial-shell";
import styles from "@/app/_components/editorial.module.css";
import { listExpertPicks } from "@/lib/db/queries";
import { stripLeadingTitleLine } from "@/lib/expert-picks-parser";

export const revalidate = 60;

export const metadata = {
  title: "전문가픽 — Vibenow",
  description: "전문가가 직접 큐레이션한 AI 소식 모음",
};

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

// 앱(둘러보기)은 최신 15개만 보여주지만, 웹은 과거 글도 찾아볼 수 있도록
// 더 넉넉하게 최대 50개까지 보여준다.
const WEB_LIST_LIMIT = 50;

export default async function ExpertPicksPage() {
  const items = await listExpertPicks(true, WEB_LIST_LIMIT);

  return (
    <EditorialShell active="picks">
      <section>
        <Link href="/app" className={styles.back}>← 트렌드 목록</Link>
        <header className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>THE EDITOR’S PICKS</p>
            <h1>전문가픽</h1>
            <p className={styles.description}>전문가가 직접 골라 전하는 AI 소식</p>
          </div>
        </header>

        {items.length === 0 ? (
          <div className={styles.empty}>
            아직 등록된 전문가픽이 없습니다.
          </div>
        ) : (
          <div className={styles.picksList}>
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/expert-picks/${item.id}`}
                className={styles.pickCard}
              >
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className={styles.pickImage}
                  />
                )}
                <div className={styles.pickCopy}>
                  <h2>
                    {item.title_ko}
                  </h2>
                  <p className={styles.summary}>
                    {truncate(stripLeadingTitleLine(item.body_ko, item.title_ko), 120)}
                  </p>
                  <div className={styles.pickMeta}>
                    {item.author_label && <span>{item.author_label}</span>}
                    {item.author_label && item.link_domain && <span>·</span>}
                    {item.link_domain && <span>{item.link_domain}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </EditorialShell>
  );
}
