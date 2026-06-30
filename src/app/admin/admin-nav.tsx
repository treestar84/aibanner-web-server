"use client";

export type AdminTab = "keywords" | "ranking" | "youtube" | "promo";

interface AdminNavProps {
  activeTab: AdminTab;
  onTabChange?: (tab: Exclude<AdminTab, "ranking">) => void;
}

const TABS: Array<{ id: AdminTab; label: string; href?: string }> = [
  { id: "keywords", label: "수동 키워드 설정" },
  { id: "ranking", label: "랭킹 시뮬레이터", href: "/admin/ranking-simulator" },
  { id: "youtube", label: "유튜브 수집 채널" },
  { id: "promo", label: "프로모션 관리" },
];

export function AdminNav({ activeTab, onTabChange }: AdminNavProps) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 mb-8">
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const cls = [
          "px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors",
          isActive
            ? "border-emerald-400 text-emerald-300"
            : "border-transparent text-zinc-400 hover:text-zinc-100 hover:border-zinc-600",
        ].join(" ");

        if (tab.href) {
          return (
            <a key={tab.id} href={tab.href} className={cls}>
              {tab.label}
            </a>
          );
        }
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange?.(tab.id as Exclude<AdminTab, "ranking">)}
            className={cls}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
