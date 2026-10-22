import { notFound } from "next/navigation";
import Link from "next/link";
import { AppCallout, EditorialShell } from "@/app/_components/editorial-shell";
import styles from "@/app/_components/editorial.module.css";
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
    <EditorialShell active="picks">
      <article className={styles.readingWidth}>
        <Link
          href="/expert-picks"
          className={styles.back}
        >
          ← 전문가픽 목록
        </Link>

        <AppCallout>Vibenow 앱에서 전문가픽 더 보기</AppCallout>

        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt=""
            className={styles.pickHero}
          />
        )}

        <header className={styles.articleHeader}>
          <h1 className={styles.pickTitle}>{item.title_ko}</h1>
          {item.author_label && (
            <p className={styles.author}>{item.author_label}</p>
          )}
        </header>

        {/* 원문 줄바꿈을 그대로 보존해 렌더링한다 — trim/정규화 금지.
            (본문 첫 줄의 제목 중복은 stripLeadingTitleLine이 제거한다.) */}
        <p className={styles.articleBody}>
          {stripLeadingTitleLine(item.body_ko, item.title_ko)}
        </p>

        {item.link_url && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.originalLink}
          >
            {item.link_domain || item.link_url} ↗
          </a>
        )}
      </article>
    </EditorialShell>
  );
}
