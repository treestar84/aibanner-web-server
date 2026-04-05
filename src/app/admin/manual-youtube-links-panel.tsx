"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface ManualYoutubeLinkItem {
  id: number;
  video_id: string;
  title: string;
  channel_name: string;
  video_url: string;
  thumbnail_url: string;
  published_at: string;
  created_at: string;
  updated_at: string;
}

interface DisplayYoutubeItem {
  id: number;
  manual_id: number | null;
  video_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string;
  video_url: string;
  published_at: string;
  source: "manual" | "auto";
}

function formatKst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    // ignore json parse errors
  }
  return `${res.status} ${res.statusText}`;
}

export function ManualYoutubeLinksPanel() {
  const [items, setItems] = useState<ManualYoutubeLinkItem[]>([]);
  const [displayItems, setDisplayItems] = useState<DisplayYoutubeItem[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingUrl, setProcessingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/manual-youtube-links", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as {
        items?: ManualYoutubeLinkItem[];
        displayItems?: DisplayYoutubeItem[];
      };
      setItems(Array.isArray(data.items) ? data.items : []);
      setDisplayItems(Array.isArray(data.displayItems) ? data.displayItems : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록 조회에 실패했습니다.");
      setItems([]);
      setDisplayItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadItems();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadItems]);

  const countText = useMemo(() => `${items.length}개`, [items]);
  const displayCountText = useMemo(() => `${displayItems.length}개`, [displayItems]);

  function resetForm() {
    setEditingId(null);
    setVideoUrl("");
  }

  function startEdit(item: ManualYoutubeLinkItem) {
    setEditingId(item.id);
    setVideoUrl(item.video_url);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveManualLink(targetVideoUrl: string, targetId?: number | null) {
    const normalizedUrl = targetVideoUrl.trim();
    if (!normalizedUrl) {
      setError("YouTube 링크를 입력해 주세요.");
      return false;
    }

    setProcessingUrl(normalizedUrl);
    setError(null);
    setNotice(null);

    try {
      const isEditing = typeof targetId === "number";
      const targetUrl = isEditing
        ? `/api/admin/manual-youtube-links/${targetId}`
        : "/api/admin/manual-youtube-links";
      const method = isEditing ? "PATCH" : "POST";
      const res = await fetch(targetUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: normalizedUrl,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      setNotice(
        isEditing
          ? "수동 유튜브 링크 수정 완료 · 제목/채널명은 자동 갱신되었습니다."
          : "수동 유튜브 링크 등록 완료 · 링크 정보가 자동 채워졌습니다."
      );
      if (isEditing && editingId === targetId) {
        resetForm();
      } else if (!isEditing) {
        resetForm();
      }
      await loadItems();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      return false;
    } finally {
      setProcessingUrl(null);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await saveManualLink(videoUrl, editingId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: ManualYoutubeLinkItem) {
    const confirmed = window.confirm(`"${item.title}" 링크를 삭제할까요?`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/manual-youtube-links/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      setNotice("수동 유튜브 링크 삭제 완료 · 앱 유튜브 탭 다음 새로고침에서 제외됩니다.");
      if (editingId === item.id) {
        resetForm();
      }
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <div className="mt-10 border-t border-zinc-800 pt-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight">수동 유튜브 링크</h2>
          <p className="mt-2 text-sm text-zinc-400">
            링크만 입력하면 제목, 채널명, 게시시각은 자동으로 채웁니다.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            수동 목록은 앱 유튜브 탭 상단에 우선 노출됩니다.
          </p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
          수동 관리 {countText}
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900/70 p-4"
      >
        <div className="grid grid-cols-1 gap-3">
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="YouTube 링크만 입력하세요"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            maxLength={500}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-900 disabled:opacity-60"
          >
            {submitting ? "저장 중..." : editingId ? "링크 수정" : "링크 등록"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm text-zinc-100"
            >
              수정 취소
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => loadItems()}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300"
          >
            새로고침
          </button>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          저장 시 같은 영상은 중복 생성하지 않고 기존 항목을 갱신합니다. 자동 수집 목록에 있는 영상이면
          해당 메타데이터를 그대로 재사용합니다.
        </p>
      </form>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-400/60 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100">
          {notice}
        </div>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">현재 앱 반영 목록</h3>
            <p className="mt-1 text-xs text-zinc-500">
              앱 유튜브 탭에 실제로 합쳐져 보이는 목록입니다. 수동 항목은 바로 수정/삭제할 수 있고,
              자동 수집 항목은 필요할 때만 수동 관리로 전환하면 됩니다.
            </p>
          </div>
          <span className="text-xs text-zinc-500">노출 기준 {displayCountText}</span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            불러오는 중...
          </div>
        ) : displayItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
            현재 앱에 반영 중인 유튜브 항목이 없습니다.
          </div>
        ) : (
          <ul className="space-y-3">
            {displayItems.map((item) => (
              <li
                key={`${item.source}-${item.video_id}`}
                className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4"
              >
                <div className="flex flex-col gap-4 md:flex-row">
                  <img
                    src={item.thumbnail_url}
                    alt={item.title}
                    className="h-[90px] w-[160px] rounded-lg border border-zinc-800 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="break-all text-lg font-bold leading-tight">
                        {item.title}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs ${
                          item.source === "manual"
                            ? "border border-emerald-500/60 text-emerald-300"
                            : "border border-zinc-700 text-zinc-400"
                        }`}
                      >
                        {item.source === "manual" ? "manual" : "auto"}
                      </span>
                    </div>
                    <p className="break-all text-sm text-zinc-300">
                      {item.channel_name || "채널명 자동 미확인"}
                    </p>
                    <a
                      href={item.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block break-all text-xs text-emerald-400 underline underline-offset-2"
                    >
                      {item.video_url}
                    </a>
                    <p className="mt-2 text-xs text-zinc-400">
                      게시(KST): {formatKst(item.published_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 self-start">
                    {item.source === "manual" && item.manual_id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const matched = items.find((candidate) => candidate.id === item.manual_id);
                            if (matched) startEdit(matched);
                          }}
                          className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100"
                        >
                          링크 수정
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const matched = items.find((candidate) => candidate.id === item.manual_id);
                            if (matched) void handleDelete(matched);
                          }}
                          className="rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                        >
                          삭제
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={processingUrl === item.video_url}
                        onClick={() => void saveManualLink(item.video_url, null)}
                        className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingUrl === item.video_url ? "추가 중..." : "수동 관리로 전환"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-zinc-100">현재 수동 관리 목록</h3>
          <span className="text-xs text-zinc-500">수정/삭제 가능</span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
            등록된 수동 유튜브 링크가 없습니다.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4"
              >
                <div className="flex flex-col gap-4 md:flex-row">
                  <img
                    src={item.thumbnail_url}
                    alt={item.title}
                    className="h-[90px] w-[160px] rounded-lg border border-zinc-800 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="break-all text-lg font-bold leading-tight">
                        {item.title}
                      </span>
                      <span className="rounded-md border border-emerald-500/60 px-2 py-0.5 text-xs text-emerald-300">
                        manual
                      </span>
                    </div>
                    <p className="break-all text-sm text-zinc-300">
                      {item.channel_name || "채널명 자동 미확인"}
                    </p>
                    <a
                      href={item.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block break-all text-xs text-emerald-400 underline underline-offset-2"
                    >
                      {item.video_url}
                    </a>
                    <p className="mt-2 text-xs text-zinc-400">
                      게시(KST): {formatKst(item.published_at)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      마지막 수정(KST): {formatKst(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 self-start">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100"
                    >
                      링크 수정
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      className="rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
