"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface YoutubeSourceChannelItem {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_handle: string;
  channel_url: string;
  latest_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
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

export function YoutubeSourceChannelsPanel() {
  const [items, setItems] = useState<YoutubeSourceChannelItem[]>([]);
  const [channelUrl, setChannelUrl] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/youtube-source-channels", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as { items?: YoutubeSourceChannelItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록 조회에 실패했습니다.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const countText = useMemo(() => `${items.length}개`, [items]);
  const lastUpdatedAt = useMemo(() => {
    const timestamps = items
      .map((item) => new Date(item.updated_at).getTime())
      .filter((value) => Number.isFinite(value));
    if (timestamps.length === 0) return "";
    return new Date(Math.max(...timestamps)).toISOString();
  }, [items]);

  function resetForm() {
    setEditingId(null);
    setChannelUrl("");
  }

  function startEdit(item: YoutubeSourceChannelItem) {
    setEditingId(item.id);
    setChannelUrl(item.channel_url);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveChannel(targetUrl: string, targetId?: number | null) {
    const normalizedUrl = targetUrl.trim();
    if (!normalizedUrl) {
      setError("YouTube 채널 링크를 입력해 주세요.");
      return;
    }

    setError(null);
    setNotice(null);
    const isEditing = typeof targetId === "number";

    try {
      const res = await fetch(
        isEditing
          ? `/api/admin/youtube-source-channels/${targetId}`
          : "/api/admin/youtube-source-channels",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelUrl: normalizedUrl }),
        }
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      setNotice(
        isEditing
          ? "유튜브 수집 채널 수정 완료 · 다음 갱신부터 새 채널 정보가 반영됩니다."
          : "유튜브 수집 채널 등록 완료 · 다음 갱신부터 수집 대상에 포함됩니다."
      );
      resetForm();
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await saveChannel(channelUrl, editingId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: YoutubeSourceChannelItem) {
    const confirmed = window.confirm(`"${item.channel_name}" 채널을 삭제할까요?`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/youtube-source-channels/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      setNotice("유튜브 수집 채널 삭제 완료 · 다음 갱신부터 수집 대상에서 제외됩니다.");
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
          <h2 className="text-2xl font-black tracking-tight">유튜브 수집 채널</h2>
          <p className="mt-2 text-sm text-zinc-400">
            채널 링크만 입력하면 채널명, handle, channel ID는 자동으로 채웁니다.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            이 목록이 다음 유튜브 추천 수집 배치의 소스로 직접 사용됩니다.
          </p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
          현재 채널 {countText}
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900/70 p-4"
      >
        <div className="grid grid-cols-1 gap-3">
          <input
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            placeholder="YouTube 채널 링크만 입력하세요"
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
            {submitting ? "저장 중..." : editingId ? "채널 수정" : "채널 등록"}
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
            onClick={() => void loadItems()}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300"
          >
            새로고침
          </button>
        </div>

        <p className="mt-2 text-xs text-zinc-500">
          지원 예시: `https://www.youtube.com/@handle`, `https://www.youtube.com/channel/UC...`
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

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">현재 수집 채널 목록</h3>
            <p className="mt-1 text-xs text-zinc-500">
              처음 등록된 기본 채널들도 여기서 같이 수정, 삭제, 추가할 수 있습니다.
            </p>
            {lastUpdatedAt ? (
              <p className="mt-1 text-xs text-zinc-600">
                채널 목록 마지막 변경(KST): {formatKst(lastUpdatedAt)}
              </p>
            ) : null}
          </div>
          <span className="text-xs text-zinc-500">다음 수집 반영</span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
            등록된 유튜브 수집 채널이 없습니다.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-zinc-700 bg-zinc-900/70 p-2"
              >
                <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-all text-sm font-bold leading-tight text-zinc-100">
                        {item.channel_name}
                      </span>
                      {item.channel_handle ? (
                        <span className="rounded-md border border-emerald-500/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          {item.channel_handle}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                      <span className="shrink-0">ID: {item.channel_id}</span>
                      <span className="hidden text-zinc-700 md:inline">•</span>
                      <span className="shrink-0">
                        업로드: {item.latest_uploaded_at ? formatKst(item.latest_uploaded_at) : "기록 없음"}
                      </span>
                      <span className="hidden text-zinc-700 md:inline">•</span>
                      <a
                        href={item.channel_url}
                        target="_blank"
                        rel="noreferrer"
                        title={item.channel_url}
                        className="min-w-0 max-w-full truncate text-[10px] text-emerald-400 underline underline-offset-2 md:max-w-[360px]"
                      >
                        {item.channel_url}
                      </a>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1 self-start md:self-center">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="rounded-md border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-100"
                    >
                      링크 수정
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="rounded-md border border-red-400/60 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-100"
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
