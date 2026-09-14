"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

interface CommunityPostItem {
  id: number;
  title_ko: string | null;
  body_ko: string;
  image_url: string | null;
  link_url: string | null;
  link_domain: string | null;
  author_type: "editor" | "user";
  author_device_id: string | null;
  author_label: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

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

function authorBadge(item: CommunityPostItem): string {
  if (item.author_type === "editor") return "에디터픽";
  if (!item.author_device_id) return item.author_label || "관리자(테스트)";
  return `사용자(${item.author_device_id.slice(0, 8)}…)`;
}

interface PostFormState {
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
  linkDomain: string;
  authorLabel: string;
}

const EMPTY_FORM: PostFormState = {
  title: "",
  body: "",
  imageUrl: "",
  linkUrl: "",
  linkDomain: "",
  authorLabel: "",
};

function PostImageField({
  imageUrl,
  onChange,
}: {
  imageUrl: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/community-posts/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      onChange(data.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">이미지 (선택)</label>
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleSelect}
          disabled={uploading}
          className="text-sm text-zinc-300"
        />
        {imageUrl && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-red-400 hover:text-red-300"
          >
            이미지 제거
          </button>
        )}
      </div>
      {uploading && <p className="text-xs text-zinc-500 mt-1">업로드 중...</p>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {imageUrl && !uploading && (
        // 미리보기 — 실제로 피드에 노출될 이미지를 그대로 보여준다.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="미리보기" className="mt-2 h-32 rounded-lg object-cover border border-zinc-700" />
      )}
    </div>
  );
}

function PostForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: PostFormState;
  submitLabel: string;
  busy: boolean;
  onSubmit: (form: PostFormState) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<PostFormState>(initial);

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-5 flex flex-col gap-4"
    >
      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">제목 (선택)</label>
        <input
          className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="제목 없이 본문만 올려도 됩니다"
          maxLength={100}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
          본문 <span className="text-red-400">*</span>
        </label>
        <textarea
          className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400 min-h-[140px] resize-y whitespace-pre-wrap"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          maxLength={1000}
        />
        <p className="text-xs text-zinc-500 mt-1">{form.body.length} / 1000자</p>
      </div>

      <PostImageField
        imageUrl={form.imageUrl}
        onChange={(imageUrl) => setForm((f) => ({ ...f, imageUrl }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">링크 URL (선택)</label>
          <input
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            value={form.linkUrl}
            onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
            placeholder="https://..."
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
            작성자 표시명 (선택, 신규 작성 시에만 적용)
          </label>
          <input
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            value={form.authorLabel}
            onChange={(e) => setForm((f) => ({ ...f, authorLabel: e.target.value }))}
            placeholder="예: 관리자(테스트)"
            maxLength={40}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-600 text-zinc-300 hover:text-zinc-100 px-4 py-2 text-sm font-bold"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !form.body.trim()}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 text-sm font-bold disabled:opacity-60"
        >
          {busy ? "처리 중..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function FullCrudSection() {
  const [items, setItems] = useState<CommunityPostItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchItems = useCallback(async (query: string) => {
    setLoading(true);
    setError("");
    try {
      const url = query
        ? `/api/admin/community-posts?q=${encodeURIComponent(query)}`
        : "/api/admin/community-posts";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    fetchItems(q);
  };

  const handleCreate = async (form: PostFormState) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/community-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          imageUrl: form.imageUrl,
          authorLabel: form.authorLabel.trim(),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setCreating(false);
      setNotice("글을 등록했습니다");
      await fetchItems(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (id: number, form: PostFormState) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/community-posts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          imageUrl: form.imageUrl,
          linkUrl: form.linkUrl.trim(),
          linkDomain: form.linkDomain.trim(),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setEditingId(null);
      setNotice("글을 수정했습니다");
      await fetchItems(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 글을 삭제하시겠습니까? (사용자 글도 삭제됩니다)")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/community-posts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setNotice("글을 삭제했습니다");
      await fetchItems(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-10">
      <h2 className="text-2xl font-black tracking-tight mb-2">커뮤니티 글 전체 관리</h2>
      <p className="text-sm text-zinc-400 mb-4">
        에디터픽·관리자 테스트글은 물론, 실제 사용자가 작성한 글의 내용까지 직접 추가·수정·삭제할 수
        있습니다. 신고 처리(작성자 차단 등)는 아래 &quot;커뮤니티 신고 검토 큐&quot;를 이용하세요.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-400/60 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목/본문 검색"
            className="w-full max-w-xs rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-sm border bg-zinc-900 border-zinc-700 text-zinc-300"
          >
            검색
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v);
            setEditingId(null);
          }}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-bold whitespace-nowrap"
        >
          {creating ? "새 글 작성 닫기" : "+ 새 글 작성"}
        </button>
      </div>

      {creating && (
        <div className="mb-6">
          <PostForm
            initial={EMPTY_FORM}
            submitLabel="등록"
            busy={busy}
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
          불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
          글이 없습니다
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id}>
                <PostForm
                  initial={{
                    title: item.title_ko ?? "",
                    body: item.body_ko,
                    imageUrl: item.image_url ?? "",
                    linkUrl: item.link_url ?? "",
                    linkDomain: item.link_domain ?? "",
                    authorLabel: item.author_label ?? "",
                  }}
                  submitLabel="저장"
                  busy={busy}
                  onSubmit={(form) => handleUpdate(item.id, form)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={item.id}
                className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4 flex gap-4"
              >
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="h-20 w-20 rounded-lg object-cover flex-shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs text-zinc-500">#{item.id}</span>
                    <span className="text-xs rounded-md px-2 py-0.5 border border-zinc-600 text-zinc-300">
                      {authorBadge(item)}
                    </span>
                  </div>
                  {item.title_ko && (
                    <p className="text-sm font-bold text-zinc-100 mb-0.5">{item.title_ko}</p>
                  )}
                  <p className="text-sm text-zinc-300 line-clamp-2 whitespace-pre-wrap">
                    {item.body_ko}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {new Date(item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </p>
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id);
                      setCreating(false);
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function ModerationQueueSection() {
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

export function CommunityPostsPanel() {
  return (
    <>
      <FullCrudSection />
      <ModerationQueueSection />
    </>
  );
}
