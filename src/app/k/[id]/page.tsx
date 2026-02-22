import { notFound } from "next/navigation";
import {
  getLatestSnapshot,
  getKeywordInLatestSnapshot,
  getSourcesByKeyword,
} from "@/lib/db/queries";
import type { Source } from "@/lib/db/queries";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

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
  return {
    title: `${keyword.keyword} — AI 트렌드`,
    description: keyword.summary_short,
  };
}

// ─── Components ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  news: "뉴스",
  web: "웹",
  video: "영상",
  image: "이미지",
};

function SourceCard({ source }: { source: Source }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 p-3 rounded-lg bg-gray-800 hover:bg-gray-750 transition-colors group"
    >
      <div className="w-16 h-12 shrink-0 rounded overflow-hidden bg-gray-700">
        <Image
          src={source.image_url}
          alt={source.title}
          width={64}
          height={48}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-2 group-hover:text-indigo-300 transition-colors">
          {source.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500">{source.domain}</span>
          {source.published_at_utc && (
            <>
              <span className="text-xs text-gray-700">·</span>
              <span className="text-xs text-gray-500">
                {new Date(source.published_at_utc).toLocaleDateString("ko-KR")}
              </span>
            </>
          )}
        </div>
        {source.snippet && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const snapshot = await getLatestSnapshot();
  if (!snapshot) notFound();

  const keyword = await getKeywordInLatestSnapshot(id);
  if (!keyword) notFound();

  const sources = await getSourcesByKeyword(snapshot.snapshot_id, id);

  const grouped = (["news", "web", "video", "image"] as const).map((type) => ({
    type,
    label: TYPE_LABELS[type],
    items: sources.filter((s) => s.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Back nav */}
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-6 transition-colors"
      >
        ← 트렌드 목록
      </Link>

      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-4xl font-black text-gray-700">
            #{keyword.rank}
          </span>
          <h1 className="text-2xl font-bold">{keyword.keyword}</h1>
          {keyword.is_new && (
            <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
              NEW
            </span>
          )}
        </div>
        <p className="text-base text-gray-300 leading-relaxed">
          {keyword.summary_short}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Snapshot: {keyword.snapshot_id}
        </p>
      </header>

      {/* Sources by type */}
      <div className="space-y-6">
        {grouped.map(({ type, label, items }) => (
          <section key={type}>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {label}
            </h2>
            <div className="space-y-2">
              {items.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          </section>
        ))}

        {grouped.length === 0 && (
          <p className="text-gray-500 text-sm py-8 text-center">
            출처 데이터를 불러오는 중입니다.
          </p>
        )}
      </div>
    </main>
  );
}
