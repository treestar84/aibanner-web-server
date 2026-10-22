import { notFound } from "next/navigation";
import {
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import type { Source } from "@/lib/db/queries";
import Link from "next/link";
import { AppCallout, EditorialShell } from "@/app/_components/editorial-shell";
import styles from "@/app/_components/editorial.module.css";
import Image from "next/image";
import type { Metadata } from "next";
import { classifySourceCategory } from "@/lib/pipeline/source_category";

export const revalidate = 900; // ISR: 15분

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const keyword = await getKeywordInLatestSnapshot(id);
  if (!keyword) return { title: "AI 트렌드 위젯" };
  const displayKeyword = keyword.keyword_ko || keyword.keyword;
  return {
    title: `${displayKeyword} — AI 트렌드`,
    description: keyword.summary_short,
    openGraph: {
      title: `${displayKeyword} — Vibenow AI 트렌드`,
      description: keyword.summary_short,
      type: "article",
      siteName: "Vibenow",
    },
  };
}

// ─── Components ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  news: "뉴스",
  social: "소셜",
  data: "데이터",
};

function SourceCard({ source }: { source: Source }) {
  const displayTitle = source.title_ko || source.title;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.sourceCard}
    >
      <div className={styles.sourceImage}>
        <Image
          src={source.image_url}
          alt={displayTitle}
          width={64}
          height={48}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className={styles.sourceTitle}>
          {displayTitle}
        </p>
        <div className={styles.sourceMeta}>
          <span>{source.domain}</span>
          {source.published_at_utc && (
            <>
              <span>·</span>
              <span>
                {new Date(source.published_at_utc).toLocaleDateString("ko-KR")}
              </span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className={styles.sourceSnippet}>
            {source.snippet}
          </p>
        )}
      </div>
    </a>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function KeywordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const from = (query.from ?? "").toLowerCase();
  const isBurningTheme = from === "burning";
  const backHref = isBurningTheme ? "/burning" : "/app";
  const backLabel = isBurningTheme ? "타는중 목록" : "트렌드 목록";
  const keyword = await getKeywordInLatestSnapshot(id);
  if (!keyword) notFound();
  const displayKeyword = keyword.keyword_ko || keyword.keyword;

  const sources = await getSourcesByKeyword(keyword.snapshot_id, id);
  const categorized: Record<"news" | "social" | "data", Source[]> = {
    news: [],
    social: [],
    data: [],
  };
  for (const source of sources) {
    const category = classifySourceCategory(source);
    categorized[category].push(source);
  }

  const grouped = (["news", "social", "data"] as const)
    .map((type) => ({
      type,
      label: TYPE_LABELS[type],
      items: categorized[type],
    }))
    .filter((g) => g.items.length > 0);

  return (
    <EditorialShell active={isBurningTheme ? "burning" : "trends"}>
      <article className={styles.readingWidth}>
        {/* Back nav */}
        <Link href={backHref} className={styles.back}>
          ← {backLabel}
        </Link>

        <AppCallout>Vibenow 앱에서 실시간 AI 트렌드 보기</AppCallout>

        {/* Header */}
        <header className={styles.articleHeader}>
          <div className={styles.articleHeading}>
            <span className={styles.articleRank}>
              #{keyword.rank}
            </span>
            <h1>{displayKeyword}</h1>
            {keyword.is_new && (
              <span className={styles.deltaNew}>
                NEW
              </span>
            )}
          </div>
          <p className={styles.articleSummary}>
            {keyword.summary_short}
          </p>
          <p className={styles.snapshot}>
            Snapshot: {keyword.snapshot_id}
          </p>
        </header>

        {/* Sources by type */}
        <div className={styles.sourceGroups}>
          {grouped.map(({ type, label, items }) => (
            <section key={type}>
              <h2 className={styles.sourceHeading}>
                {label}
              </h2>
              <div className={styles.sourceList}>
                {items.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
            </section>
          ))}

          {grouped.length === 0 && (
            <p className={styles.empty}>
              출처 데이터를 불러오는 중입니다.
            </p>
          )}
        </div>
      </article>
    </EditorialShell>
  );
}
