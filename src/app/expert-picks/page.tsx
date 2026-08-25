import Link from "next/link";
import { listExpertPicks } from "@/lib/db/queries";

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

export default async function ExpertPicksPage() {
  const items = await listExpertPicks(true);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="max-w-2xl mx-auto px-4 py-8">
        <header className="mb-6">
          <Link
            href="/app"
            className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 mb-5 transition-colors"
          >
            ← 트렌드 목록
          </Link>
          <h1 className="text-2xl font-black tracking-tight">전문가픽</h1>
          <p className="text-sm text-zinc-400 mt-1">
            전문가가 직접 골라 전하는 AI 소식
          </p>
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-500 text-sm">
            아직 등록된 전문가픽이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/expert-picks/${item.id}`}
                className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 hover:bg-zinc-900 hover:border-zinc-700 transition-colors group"
              >
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-20 h-20 shrink-0 rounded-lg object-cover bg-zinc-800"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold leading-snug group-hover:text-violet-300 transition-colors line-clamp-2">
                    {item.title_ko}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1.5 line-clamp-2 whitespace-pre-wrap">
                    {truncate(item.body_ko, 120)}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
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
    </main>
  );
}
