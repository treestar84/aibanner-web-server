import { notFound } from "next/navigation";
import {
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import type { Source } from "@/lib/db/queries";
import Link from "next/link";
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
  };
}

// ─── Components ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  news: "뉴스",
  social: "소셜",
  data: "데이터",
};

function SourceCard({
  source,
  burningTheme,
}: {
  source: Source;
  burningTheme: boolean;
}) {
  const displayTitle = source.title_ko || source.title;
  const cardClass = burningTheme
    ? "flex gap-3 p-3 rounded-lg bg-red-950/35 border border-red-400/20 hover:bg-red-900/35 transition-colors group"
    : "flex gap-3 p-3 rounded-lg bg-gray-800 hover:bg-gray-750 transition-colors group";
  const imageBgClass = burningTheme ? "bg-red-950/40" : "bg-gray-700";
  const titleClass = burningTheme
    ? "text-sm font-medium line-clamp-2 group-hover:text-red-200 transition-colors"
    : "text-sm font-medium line-clamp-2 group-hover:text-indigo-300 transition-colors";
  const metaTextClass = burningTheme ? "text-xs text-red-200/65" : "text-xs text-gray-500";
  const dividerClass = burningTheme ? "text-xs text-red-200/35" : "text-xs text-gray-700";
  const snippetClass = burningTheme ? "text-xs text-red-100/65 mt-1 line-clamp-2" : "text-xs text-gray-500 mt-1 line-clamp-2";
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cardClass}
    >
      <div className={`w-16 h-12 shrink-0 rounded overflow-hidden ${imageBgClass}`}>
        <Image
          src={source.image_url}
          alt={displayTitle}
          width={64}
          height={48}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className={titleClass}>
          {displayTitle}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={metaTextClass}>{source.domain}</span>
          {source.published_at_utc && (
            <>
              <span className={dividerClass}>·</span>
              <span className={metaTextClass}>
                {new Date(source.published_at_utc).toLocaleDateString("ko-KR")}
              </span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className={snippetClass}>
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
  const pageClass = isBurningTheme
    ? "max-w-2xl mx-auto px-4 py-8 min-h-screen"
    : "max-w-2xl mx-auto px-4 py-8";
  const shellClass = isBurningTheme
    ? "rounded-2xl border border-red-400/25 bg-gradient-to-b from-red-950/55 via-red-950/20 to-transparent p-5 shadow-[0_18px_50px_rgba(132,20,20,0.35)]"
    : "";
  const backClass = isBurningTheme
    ? "inline-flex items-center gap-1 text-sm text-red-200/80 hover:text-red-100 mb-6 transition-colors"
    : "inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-6 transition-colors";
  const rankClass = isBurningTheme ? "text-4xl font-black text-red-200/80" : "text-4xl font-black text-gray-700";
  const summaryClass = isBurningTheme
    ? "text-base text-red-50/90 leading-relaxed"
    : "text-base text-gray-300 leading-relaxed";
  const snapshotClass = isBurningTheme ? "text-xs text-red-100/60 mt-2" : "text-xs text-gray-500 mt-2";
  const sectionTitleClass = isBurningTheme
    ? "text-sm font-semibold text-red-200/80 uppercase tracking-wider mb-3"
    : "text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3";
  const emptyStateClass = isBurningTheme
    ? "text-red-100/70 text-sm py-8 text-center"
    : "text-gray-500 text-sm py-8 text-center";
  const newBadgeClass = isBurningTheme
    ? "text-xs font-bold text-orange-100 bg-red-500/25 border border-red-300/40 px-2 py-1 rounded"
    : "text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded";

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
    <main className={pageClass}>
      <div className={shellClass}>
        {/* Back nav */}
        <Link href={backHref} className={backClass}>
          ← {backLabel}
        </Link>

        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className={rankClass}>
              #{keyword.rank}
            </span>
            <h1 className="text-2xl font-bold">{displayKeyword}</h1>
            {keyword.is_new && (
              <span className={newBadgeClass}>
                NEW
              </span>
            )}
          </div>
          <p className={summaryClass}>
            {keyword.summary_short}
          </p>
          <p className={snapshotClass}>
            Snapshot: {keyword.snapshot_id}
          </p>
        </header>

        {/* Sources by type */}
        <div className="space-y-6">
          {grouped.map(({ type, label, items }) => (
            <section key={type}>
              <h2 className={sectionTitleClass}>
                {label}
              </h2>
              <div className="space-y-2">
                {items.map((source) => (
                  <SourceCard key={source.id} source={source} burningTheme={isBurningTheme} />
                ))}
              </div>
            </section>
          ))}

          {grouped.length === 0 && (
            <p className={emptyStateClass}>
              출처 데이터를 불러오는 중입니다.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
