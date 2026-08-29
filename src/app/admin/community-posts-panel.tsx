"use client";

import { useCallback, useEffect, useState } from "react";

interface ReportedPostItem {
  id: number;
  title_ko: string;
  body_ko: string;
  author_type: string;
  author_device_id: string | null;
  report_count: number;
  created_at: string;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    // ignore
  }
  return `${res.status} ${res.statusText}`;
}

export function CommunityPostsPanel() {
  const [items, setItems] = useState<ReportedPostItem[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/posts/reported");
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다");
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleResolve = async (id: number, action: "remove" | "restore") => {
    if (action === "remove" && !confirm("이 글을 삭제 확정하시겠습니까?")) return;
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/posts/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 실패");
    } finally {
      setBusyId(null);
    }
  };

  const handleBanAuthor = async (item: ReportedPostItem) => {
    if (!item.author_device_id) {
      setError("작성자 기기 정보가 없습니다");
      return;
    }
    if (!confirm("이 작성자 기기를 영구 차단하시겠습니까?")) return;
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/devices/${item.author_device_id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permanently: true }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "차단 실패");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <h2 className="text-2xl font-black tracking-tight mb-2">커뮤니티 신고 검토 큐</h2>
      <p className="text-sm text-zinc-400 mb-6">
        신고 누적으로 자동 숨김 처리된 글입니다. 삭제를 확정하면 정확한 신고를 한 기기에 포인트가
        지급되고, 복원하면 다시 노출됩니다.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      <div>
        <h3 className="text-base font-bold text-zinc-200 mb-3">신고된 글 ({items.length}개)</h3>
        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-xs text-zinc-400 bg-zinc-900/60">
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">내용</th>
                <th className="px-3 py-3 text-center">신고 수</th>
                <th className="px-3 py-3 text-center">작성자</th>
                <th className="px-3 py-3 text-center">처리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 text-zinc-500">{item.id}</td>
                  <td className="px-3 py-2.5 text-zinc-200 font-medium">
                    <p className="mb-0.5">{item.title_ko}</p>
                    <p className="text-xs text-zinc-500 line-clamp-2">{item.body_ko}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center text-zinc-300">{item.report_count}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-zinc-500">
                    {item.author_type === "user" ? item.author_device_id : "editor"}
                  </td>
                  <td className="px-3 py-2.5 text-center whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleResolve(item.id, "remove")}
                      className="text-xs text-red-400 hover:text-red-300 mr-3 disabled:opacity-50"
                    >
                      삭제 확정
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleResolve(item.id, "restore")}
                      className="text-xs text-emerald-400 hover:text-emerald-300 mr-3 disabled:opacity-50"
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id || item.author_type !== "user"}
                      onClick={() => handleBanAuthor(item)}
                      className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                    >
                      작성자 차단
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-zinc-500 text-sm">
                    신고된 글이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
