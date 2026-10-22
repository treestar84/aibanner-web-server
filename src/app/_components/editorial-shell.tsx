import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./editorial.module.css";

type Section = "trends" | "burning" | "picks";

const navigation: { section: Section; href: string; label: string }[] = [
  { section: "trends", href: "/app", label: "실시간 소식" },
  { section: "burning", href: "/burning", label: "타는중" },
  { section: "picks", href: "/expert-picks", label: "전문가픽" },
];

// Server-only presentation shell: no data fetching, browser state, or global CSS.
export function EditorialShell({
  active,
  children,
}: {
  active: Section;
  children: ReactNode;
}) {
  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#editorial-content">본문으로 건너뛰기</a>
      <header className={styles.masthead}>
        <div className={styles.mastheadTop}>
          <p className={styles.mastheadNote}>변화의 속도보다,<br />한 걸음 깊은 시선.</p>
          <Link href="/app" prefetch={false} className={styles.brand} aria-label="VibeNow 실시간 소식">
            <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
            <span>VibeNow<span className={styles.brandPeriod}>.</span></span>
          </Link>
          <p className={styles.edition}>DAILY BRIEF<span>AI, IN CONTEXT.</span></p>
        </div>
        <div className={styles.navRow}>
          <nav className={styles.nav} aria-label="주요 메뉴">
            {navigation.map(({ section, href, label }) => (
              <Link key={section} href={href} prefetch={false} aria-current={active === section ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <span className={styles.navCaption}>A LITTLE MORE CONTEXT.</span>
        </div>
      </header>
      <main id="editorial-content" className={styles.main} tabIndex={-1}>{children}</main>
      <footer className={styles.footer}>
        <Link href="/app" prefetch={false} className={styles.footerBrand}>VibeNow.</Link>
        <p>하나의 키워드, 여러 개의 시선.</p>
        <span>AI, IN CONTEXT.</span>
      </footer>
    </div>
  );
}

export function AppCallout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.appCallout}>
      <div>
        <p>{children}</p>
        <span>위젯·알림으로 매일 업데이트를 받아보세요</span>
      </div>
      <a className={styles.primaryLink} href="https://play.google.com/store/apps/details?id=com.aitrendwidget.ai_trend_news">
        앱 받기 <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}
