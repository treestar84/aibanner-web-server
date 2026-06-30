"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

interface PromoItem {
  id: number;
  slug: string;
  tag: string;
  tag_color: string;
  title_ko: string;
  title_en: string;
  subtitle_ko: string;
  subtitle_en: string;
  body_ko: string;
  body_en: string;
  image_url: string;
  gradient_from: string;
  gradient_to: string;
  icon_name: string;
  link_url: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface PreviewProps {
  title: string;
  subtitle: string;
  body: string;
  imageUrl: string;
  tag: string;
  tagColor: string;
  gradientFrom: string;
  gradientTo: string;
  linkUrl: string;
}

function PromoPreviewCard({
  title,
  subtitle,
  body,
  imageUrl,
  tag,
  tagColor,
  gradientFrom,
  gradientTo,
  linkUrl,
}: PreviewProps) {
  const heroStyle: React.CSSProperties = {
    height: 220,
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    background: imageUrl
      ? undefined
      : `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`,
    borderRadius: "12px 12px 0 0",
    overflow: "hidden",
  };

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #3f3f46",
        background: "#18181b",
        maxWidth: 380,
      }}
    >
      {/* 히어로 영역 */}
      <div style={heroStyle}>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}
        {/* 하단 그라데이션 오버레이 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.72) 100%)",
          }}
        />
        {/* 태그 + 제목 */}
        <div style={{ position: "relative", padding: "16px 20px", width: "100%" }}>
          {tag && (
            <span
              style={{
                background: tagColor,
                color: "#fff",
                padding: "3px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                display: "inline-block",
                marginBottom: 8,
                letterSpacing: "0.03em",
              }}
            >
              {tag}
            </span>
          )}
          <div
            style={{
              color: "#fff",
              fontWeight: 800,
              fontSize: 18,
              lineHeight: 1.3,
            }}
          >
            {title || (
              <span style={{ opacity: 0.4 }}>제목을 입력하세요</span>
            )}
          </div>
        </div>
      </div>

      {/* 본문 영역 */}
      <div style={{ padding: "18px 20px" }}>
        {subtitle && (
          <div
            style={{
              color: gradientFrom,
              fontWeight: 700,
              fontSize: 14,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </div>
        )}
        {body ? (
          <div
            style={{
              color: "#a1a1aa",
              fontSize: 13,
              lineHeight: 1.75,
              whiteSpace: "pre-wrap",
            }}
          >
            {body}
          </div>
        ) : (
          <div style={{ color: "#52525b", fontSize: 13 }}>본문을 입력하세요</div>
        )}
        {linkUrl && (
          <div
            style={{
              marginTop: 20,
              width: "100%",
              background: gradientFrom,
              color: "#fff",
              borderRadius: 10,
              padding: "12px 0",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            자세히 보기 ↗
          </div>
        )}
      </div>
    </div>
  );
}

function PromoModal({
  item,
  onClose,
}: {
  item: PromoItem;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.75)",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{ width: "100%", maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-zinc-400 font-semibold">미리보기</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <PromoPreviewCard
          title={item.title_ko}
          subtitle={item.subtitle_ko}
          body={item.body_ko}
          imageUrl={item.image_url}
          tag={item.tag}
          tagColor={item.tag_color || "#7C3AED"}
          gradientFrom={item.gradient_from || "#7C3AED"}
          gradientTo={item.gradient_to || "#4F46E5"}
          linkUrl={item.link_url}
        />
      </div>
    </div>
  );
}

function generateSlug(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || `promo-${Date.now()}`
  );
}

function extractFirstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^.+?[.!?。]\s*/);
  return match ? match[0].trim() : trimmed.slice(0, 80);
}

export function PromoContentsPanel() {
  const [items, setItems] = useState<PromoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState<PromoItem | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 기본 필드
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // 고급 필드
  const [tag, setTag] = useState("NEW");
  const [tagColor, setTagColor] = useState("#7C3AED");
  const [gradientFrom, setGradientFrom] = useState("#7C3AED");
  const [gradientTo, setGradientTo] = useState("#4F46E5");
  const [linkUrl, setLinkUrl] = useState("");

  const derivedSubtitle = body.trim() ? extractFirstSentence(body) : "";

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/promo-contents");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setError("Failed to fetch promo contents");
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("제목을 입력해주세요");
      return;
    }
    if (!body.trim()) {
      setError("본문을 입력해주세요");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const subtitle = extractFirstSentence(body);
      const maxSort =
        items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : -1;

      const res = await fetch("/api/admin/promo-contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: generateSlug(title),
          titleKo: title.trim(),
          subtitleKo: subtitle,
          bodyKo: body.trim(),
          imageUrl: imageUrl.trim(),
          tag: tag.trim() || "NEW",
          tagColor,
          gradientFrom,
          gradientTo,
          linkUrl: linkUrl.trim(),
          sortOrder: maxSort + 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setTitle("");
      setBody("");
      setImageUrl("");
      setTag("NEW");
      setTagColor("#7C3AED");
      setGradientFrom("#7C3AED");
      setGradientTo("#4F46E5");
      setLinkUrl("");
      await fetchItems();
    } catch {
      setError("Failed to create promo");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    await fetch(`/api/admin/promo-contents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    await fetchItems();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/admin/promo-contents/${id}`, { method: "DELETE" });
    await fetchItems();
  };

  return (
    <section>
      <h2 className="text-2xl font-black tracking-tight mb-2">프로모션 관리</h2>
      <p className="text-sm text-zinc-400 mb-6">
        앱 홈 화면에 노출되는 프로모션 콘텐츠를 등록하고 관리합니다.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {/* ── 폼 + 실시간 미리보기 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 폼 */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-5 flex flex-col gap-4"
        >
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              제목 <span className="text-red-400">*</span>
            </label>
            <input
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="프로모션 제목을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              본문 <span className="text-red-400">*</span>
            </label>
            <textarea
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400 min-h-[100px] resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="프로모션 내용을 입력하세요 (첫 문장이 부제목으로 사용됩니다)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              이미지 URL
            </label>
            <input
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* 고급 설정 토글 */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
            >
              <span>{showAdvanced ? "▲" : "▼"}</span>
              고급 설정 (태그·색상·링크)
            </button>

            {showAdvanced && (
              <div className="mt-3 flex flex-col gap-3 pl-3 border-l border-zinc-700">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">태그</label>
                    <input
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="NEW"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">태그 색상</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={tagColor}
                        onChange={(e) => setTagColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-emerald-400 font-mono"
                        value={tagColor}
                        onChange={(e) => setTagColor(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">그라데이션 시작</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={gradientFrom}
                        onChange={(e) => setGradientFrom(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-emerald-400 font-mono"
                        value={gradientFrom}
                        onChange={(e) => setGradientFrom(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">그라데이션 끝</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={gradientTo}
                        onChange={(e) => setGradientTo(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-emerald-400 font-mono"
                        value={gradientTo}
                        onChange={(e) => setGradientTo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">외부 링크 URL</label>
                  <input
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 text-sm font-bold disabled:opacity-60 transition-colors"
            >
              {loading ? "등록 중..." : "등록"}
            </button>
          </div>
        </form>

        {/* 실시간 미리보기 */}
        <div>
          <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">
            실시간 미리보기
          </p>
          <PromoPreviewCard
            title={title}
            subtitle={derivedSubtitle}
            body={body}
            imageUrl={imageUrl}
            tag={tag}
            tagColor={tagColor}
            gradientFrom={gradientFrom}
            gradientTo={gradientTo}
            linkUrl={linkUrl}
          />
        </div>
      </div>

      {/* ── 등록된 목록 ── */}
      <div>
        <h3 className="text-base font-bold text-zinc-200 mb-3">
          등록된 프로모션 ({items.length}개)
        </h3>
        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-xs text-zinc-400 bg-zinc-900/60">
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">태그</th>
                <th className="px-3 py-3 text-left">제목</th>
                <th className="px-3 py-3 text-center">순서</th>
                <th className="px-3 py-3 text-center">활성</th>
                <th className="px-3 py-3 text-center">미리보기</th>
                <th className="px-3 py-3 text-center">삭제</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="px-3 py-2.5 text-zinc-500">{item.id}</td>
                  <td className="px-3 py-2.5">
                    <span
                      style={{ background: item.tag_color || "#7C3AED" }}
                      className="text-white px-2 py-0.5 rounded text-[11px] font-bold"
                    >
                      {item.tag || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-200 font-medium">
                    {item.title_ko}
                  </td>
                  <td className="px-3 py-2.5 text-center text-zinc-400">
                    {item.sort_order}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(item.id, item.enabled)}
                      className="text-base leading-none"
                    >
                      {item.enabled ? "✅" : "❌"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
                    >
                      미리보기
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-zinc-500 text-sm"
                  >
                    등록된 프로모션이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 미리보기 모달 ── */}
      {previewItem && (
        <PromoModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </section>
  );
}
