import { getLatestSnapshotWithKeywords, getTopKeywords } from "@/lib/db/queries";
import Link from "next/link";
import Image from "next/image";

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
      <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
        NEW
      </span>
    );
  }
  if (delta > 0)
    return (
      <span className="text-xs text-emerald-400">▲{delta}</span>
    );
  if (delta < 0)
    return (
      <span className="text-xs text-red-400">▼{Math.abs(delta)}</span>
    );
  return <span className="text-xs text-gray-500">━</span>;
}

export default async function TrendsPage() {
  const snapshot = await getLatestSnapshotWithKeywords();

  if (!snapshot) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">아직 데이터가 없습니다. 잠시 후 다시 확인해주세요.</p>
      </main>
    );
  }

  const keywords = await getTopKeywords(snapshot.snapshot_id, 10);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          AI 트렌드 실검
        </h1>
        <p className="text-sm text-gray-400">
          업데이트: {formatKST(snapshot.updated_at_utc)} KST ·{" "}
          다음 업데이트: {formatKST(snapshot.next_update_at_utc)} KST
        </p>
      </header>

      {/* Trend list */}
      <ol className="space-y-3">
        {keywords.map((kw) => (
          <li key={kw.keyword_id}>
            <Link
              href={`/k/${kw.keyword_id}`}
              className="flex items-start gap-4 p-4 rounded-xl bg-gray-900 hover:bg-gray-800 transition-colors group"
            >
              {/* Rank */}
              <span
                className={`text-2xl font-black w-8 shrink-0 text-right leading-none pt-0.5 ${
                  kw.rank <= 3 ? "text-indigo-400" : "text-gray-600"
                }`}
              >
                {kw.rank}
              </span>

              {/* Thumbnail */}
              {kw.top_source_image_url && (
                <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-gray-800">
                  <Image
                    src={kw.top_source_image_url}
                    alt={kw.keyword}
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-base group-hover:text-indigo-300 transition-colors truncate">
                    {kw.keyword}
                  </span>
                  <DeltaBadge delta={kw.delta_rank} isNew={kw.is_new} />
                </div>
                <p className="text-sm text-gray-400 line-clamp-2">
                  {kw.summary_short}
                </p>
                {kw.top_source_domain && (
                  <p className="text-xs text-gray-600 mt-1">
                    {kw.top_source_domain}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ol>

      <footer className="mt-8 text-center text-xs text-gray-600">
        Snapshot ID: {snapshot.snapshot_id}
      </footer>
    </main>
  );
}
