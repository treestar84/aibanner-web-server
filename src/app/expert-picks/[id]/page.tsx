import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getExpertPickById } from "@/lib/db/queries";
import { stripLeadingTitleLine } from "@/lib/expert-picks-parser";

export const revalidate = 900; // ISR: 15분

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return { title: "전문가픽 — Vibenow" };

  const item = await getExpertPickById(numericId);
  if (!item || !item.enabled) return { title: "전문가픽 — Vibenow" };

  const description = stripLeadingTitleLine(item.body_ko, item.title_ko)
    .trim()
    .slice(0, 120);
  return {
    title: `${item.title_ko} — Vibenow 전문가픽`,
    description,
    openGraph: {
      title: item.title_ko,
      description,
      type: "article",
      siteName: "Vibenow",
      ...(item.image_url ? { images: [{ url: item.image_url }] } : {}),
    },
  };
}

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.aitrendwidget.ai_trend_news";

export default async function ExpertPickDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) notFound();

  const item = await getExpertPickById(numericId);
  if (!item || !item.enabled) notFound();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/expert-picks"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 mb-6 transition-colors"
        >
          ← 전문가픽 목록
        </Link>

        {/* 앱 CTA */}
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-violet-400/25 bg-violet-950/30 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-100">
              Vibenow 앱에서 전문가픽 더 보기
            </p>
            <p className="text-xs text-violet-200/70 mt-0.5">
              위젯·알림으로 매일 업데이트를 받아보세요
            </p>
          </div>
          <a
            href={PLAY_STORE_URL}
            className="shrink-0 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 transition-colors"
          >
            앱 받기
          </a>
        </div>

        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt=""
            className="w-full max-h-96 object-cover rounded-2xl mb-6 bg-zinc-900"
          />
        )}

        <header className="mb-6">
          <h1 className="text-2xl font-bold leading-tight">{item.title_ko}</h1>
          {item.author_label && (
            <p className="text-sm text-zinc-400 mt-2">{item.author_label}</p>
          )}
        </header>

        {/* 원문 줄바꿈을 그대로 보존해 렌더링한다 — trim/정규화 금지.
            (본문 첫 줄의 제목 중복은 stripLeadingTitleLine이 제거한다.) */}
        <p className="text-base text-zinc-200 leading-relaxed whitespace-pre-wrap">
          {stripLeadingTitleLine(item.body_ko, item.title_ko)}
        </p>

        {item.link_url && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
          >
            {item.link_domain || item.link_url} ↗
          </a>
        )}
      </section>
    </main>
  );
}
