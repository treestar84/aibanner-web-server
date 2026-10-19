import { cache } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  findRemovedCommunityItems,
  getReceiptByCode as loadReceiptByCode,
  isLinkPreviewBot,
  maskReceiptItems,
  receiptVisitorHash,
  recordReceiptOpen,
} from "@/lib/receipts";

// 열람 집계가 목적이라 캐시하면 안 된다.
export const dynamic = "force-dynamic";

const REMOVED_PLACEHOLDER = "(삭제되었거나 숨겨진 글입니다)";

// generateMetadata와 페이지가 같은 요청에서 한 번만 조회하도록. 담긴 커뮤니티
// 글이 나중에 삭제·숨김되면 그 항목은 공개 페이지에서 가린다.
const getReceiptByCode = cache(async (code: string) => {
  const receipt = await loadReceiptByCode(code);
  if (!receipt) return null;
  let removed = new Set<number>();
  try {
    removed = await findRemovedCommunityItems(receipt.contentKeys);
  } catch (err) {
    console.error("[/r/[code]] removed-item lookup failed", err);
  }
  return { ...receipt, body: maskReceiptItems(receipt.body, removed, REMOVED_PLACEHOLDER) };
});

let warnedMissingSecret = false;

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.aitrendwidget.ai_trend_news";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const receipt = await getReceiptByCode(code);
  // 사용자가 쓴 본문이 그대로 올라가는 페이지라 검색 색인은 막는다.
  const robots = { index: false, follow: false };
  if (!receipt) return { title: "Vibenow 영수증", robots };
  const title = `Vibenow 트렌드 영수증 · ${receipt.itemCount}건`;
  const description = receipt.body.split("\n").slice(0, 6).join(" ").slice(0, 160);
  return {
    title,
    description,
    openGraph: { title, description, type: "article", siteName: "Vibenow" },
    robots,
  };
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function linkify(line: string) {
  return line.split(URL_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline decoration-dotted break-all"
      >
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const receipt = await getReceiptByCode(code);
  if (!receipt) notFound();

  const h = await headers();
  const userAgent = h.get("user-agent") ?? "";
  const ip =
    (h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  let openCount = receipt.openCount;
  if (!isLinkPreviewBot(userAgent)) {
    const visitorHash = receiptVisitorHash(ip);
    if (!visitorHash && !warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn("[/r/[code]] VIEW_EVENT_HMAC_SECRET is not set; receipt opens are not counted");
    }
    if (visitorHash) {
      try {
        if (await recordReceiptOpen(receipt.id, visitorHash)) openCount += 1;
      } catch (err) {
        // 집계 실패가 영수증 열람을 막지 않게 한다.
        console.error("[/r/[code]] open tracking failed", err);
      }
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-10">
      <div className="relative bg-[#fbfaf6] text-[#1d1d1b] rounded-t-md px-6 pt-7 pb-9 shadow-[0_24px_60px_rgba(0,0,0,0.45)] font-mono text-[13px] leading-6 [clip-path:polygon(0_0,100%_0,100%_calc(100%-8px),95%_100%,90%_calc(100%-8px),85%_100%,80%_calc(100%-8px),75%_100%,70%_calc(100%-8px),65%_100%,60%_calc(100%-8px),55%_100%,50%_calc(100%-8px),45%_100%,40%_calc(100%-8px),35%_100%,30%_calc(100%-8px),25%_100%,20%_calc(100%-8px),15%_100%,10%_calc(100%-8px),5%_100%,0_calc(100%-8px))]">
        {receipt.body.split("\n").map((line, index) => (
          <p key={index} className="whitespace-pre-wrap break-words min-h-6">
            {linkify(line)}
          </p>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        ✈ 이 영수증을 {openCount.toLocaleString("ko-KR")}명이 열어봤어요
      </p>

      <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-indigo-400/25 bg-indigo-950/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-100">나도 영수증 발행하기</p>
          <p className="text-xs text-indigo-200/70 mt-0.5">
            Vibenow에서 AI 트렌드를 모아 한 장으로 공유해 보세요
          </p>
        </div>
        <a
          href={PLAY_STORE_URL}
          className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors"
        >
          앱 받기
        </a>
      </div>
    </main>
  );
}
