"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildManualKeywordFeedback,
  type ManualKeywordFeedback,
  type ManualKeywordOnDemandSnapshot,
} from "@/lib/manual-keyword-feedback";

type PipelineMode = "realtime";

interface ManualKeywordItem {
  id: number;
  keyword: string;
  mode: PipelineMode;
  ttl_hours: number;
  enabled: boolean;
  starts_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  remaining_seconds: number;
  is_active: boolean;
}

interface AdminCreateResponse {
  ok: boolean;
  item?: ManualKeywordItem;
  onDemandSnapshot?: ManualKeywordOnDemandSnapshot;
  error?: string;
}

interface AdminMutationResponse extends AdminCreateResponse {}

interface AdminDeleteResponse {
  ok: boolean;
  onDemandSnapshot?: ManualKeywordOnDemandSnapshot;
  error?: string;
}

const TTL_OPTIONS = [6, 12, 24];

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

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "만료";
  const hour = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  if (hour > 0) return `${hour}시간 ${min}분`;
  return `${Math.max(1, min)}분`;
}

function statusText(item: ManualKeywordItem): string {
  if (!item.enabled) return "비활성";
  if (item.is_active) return "활성";
  return "만료";
}

function statusClass(item: ManualKeywordItem): string {
  if (!item.enabled) return "bg-zinc-700/70 text-zinc-200 border-zinc-500/70";
  if (item.is_active) return "bg-emerald-500/15 text-emerald-200 border-emerald-400/60";
  return "bg-amber-500/15 text-amber-200 border-amber-300/60";
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

export default function AdminPage() {
  const [items, setItems] = useState<ManualKeywordItem[]>([]);
  const [modeFilter, setModeFilter] = useState<"all" | PipelineMode>("all");
  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState<PipelineMode>("realtime");
  const [ttlHours, setTtlHours] = useState<number>(6);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ManualKeywordFeedback | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = modeFilter === "all" ? "" : `?mode=${modeFilter}`;
      const res = await fetch(`/api/admin/manual-keywords${query}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as { items?: ManualKeywordItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록 조회에 실패했습니다.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [modeFilter]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadItems();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadItems]);

  const activeCount = useMemo(
    () => items.filter((item) => item.enabled && item.is_active).length,
    [items]
  );

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!keyword.trim()) {
      setError("키워드를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/manual-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          mode,
          ttlHours,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const payload = (await res.json()) as AdminCreateResponse;
      setKeyword("");
      setNotice(
        buildManualKeywordFeedback({
          action: "create",
          item: payload.item,
          snapshot: payload.onDemandSnapshot,
        })
      );

      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(
    item: ManualKeywordItem,
    action: "extend" | "enable" | "disable",
    extendTtl?: number
  ) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/manual-keywords/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ttlHours: extendTtl,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const payload = (await res.json()) as AdminMutationResponse;
      setNotice(
        buildManualKeywordFeedback({
          action,
          previousItem: item,
          item: payload.item,
          ttlHours: extendTtl,
          snapshot: payload.onDemandSnapshot,
        })
      );
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업에 실패했습니다.");
    }
  }

  async function runDelete(item: ManualKeywordItem) {
    const confirmed = window.confirm(`"${item.keyword}" 키워드를 삭제할까요?`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/manual-keywords/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const payload = (await res.json()) as AdminDeleteResponse;
      setNotice(
        buildManualKeywordFeedback({
          action: "delete",
          deletedKeyword: item.keyword,
          snapshot: payload.onDemandSnapshot,
        })
      );
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8">
      <section className="max-w-5xl mx-auto">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">관리자 · 수동 키워드</h1>
            <p className="text-sm text-zinc-400 mt-2">
              등록된 수동 키워드는 파이프라인에서 강제 포함되어 상단 노출 우선순위를 갖습니다.
            </p>
          </div>
          <div className="text-sm text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
            활성 {activeCount}개 / 전체 {items.length}개
          </div>
        </header>

        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4 mb-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="수동 키워드 입력 (예: Gemini 3.0)"
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              maxLength={120}
            />
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PipelineMode)}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              <option value="realtime">realtime</option>
            </select>
            <select
              value={ttlHours}
              onChange={(e) => setTtlHours(Number.parseInt(e.target.value, 10))}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              {TTL_OPTIONS.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}시간 유지
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-500 text-zinc-900 px-4 py-2 text-sm font-bold disabled:opacity-60"
            >
              {submitting ? "등록 중..." : "키워드 등록"}
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            동일 모드에서 같은 키워드를 다시 등록하면 중복 생성 대신 만료 시간이 갱신되며,
            등록 직후 해당 모드 스냅샷이 즉시 실행됩니다.
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            연장 버튼은 지금 시점이 아니라 현재 만료 시각 뒤로 누적되며, 이미 만료된 항목만 새 TTL 창으로 다시 시작합니다.
          </p>
        </form>

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModeFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-sm border ${
              modeFilter === "all"
                ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-100"
                : "bg-zinc-900 border-zinc-700 text-zinc-300"
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setModeFilter("realtime")}
            className={`rounded-lg px-3 py-1.5 text-sm border ${
              modeFilter === "realtime"
                ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-100"
                : "bg-zinc-900 border-zinc-700 text-zinc-300"
            }`}
          >
            realtime
          </button>
          <button
            type="button"
            onClick={() => loadItems()}
            className="rounded-lg px-3 py-1.5 text-sm border bg-zinc-900 border-zinc-700 text-zinc-300"
          >
            새로고침
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {notice && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-sm font-semibold ${
              notice.tone === "warning"
                ? "border border-amber-300/60 bg-amber-500/10 text-amber-100"
                : "border border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {notice.message}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            등록된 수동 키워드가 없습니다.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-lg font-bold leading-tight break-all">
                        {item.keyword}
                      </span>
                      <span className="text-xs rounded-md px-2 py-0.5 border border-zinc-600 text-zinc-300">
                        {item.mode}
                      </span>
                      <span
                        className={`text-xs rounded-md px-2 py-0.5 border ${statusClass(item)}`}
                      >
                        {statusText(item)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      남은 시간: {formatRemaining(item.remaining_seconds)} · 만료(KST):{" "}
                      {formatKst(item.expires_at)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      등록(KST): {formatKst(item.created_at)} · 마지막 수정(KST):{" "}
                      {formatKst(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TTL_OPTIONS.map((hour) => (
                      <button
                        key={hour}
                        type="button"
                        onClick={() => runAction(item, "extend", hour)}
                        className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100"
                      >
                        +{hour}시간 연장
                      </button>
                    ))}
                    {item.enabled ? (
                      <button
                        type="button"
                        onClick={() => runAction(item, "disable")}
                        className="rounded-lg border border-zinc-500/70 bg-zinc-700/30 px-3 py-1.5 text-xs text-zinc-200"
                      >
                        비활성화
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runAction(item, "enable")}
                        className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100"
                      >
                        재활성화
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runDelete(item)}
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
    </main>
  );
}
