"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { parseExpertPickPaste } from "@/lib/expert-picks-parser";

interface ExpertPickItem {
  id: number;
  title_ko: string;
  body_ko: string;
  body_ko_raw: string;
  ai_tuned: boolean;
  image_url: string;
  link_url: string;
  link_domain: string;
  author_label: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  version: number;
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

export function ExpertPicksPanel() {
  const [items, setItems] = useState<ExpertPickItem[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [pasteText, setPasteText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [authorLabel, setAuthorLabel] = useState("");

  const [tuning, setTuning] = useState(false);
  // AI 재작성 미리보기 — 제목도 원문을 베끼지 않고 새로 쓰므로 본문과 함께 쌍으로 보관한다.
  const [tunedPreview, setTunedPreview] = useState<{ title: string; body: string } | null>(null);
  // "이 버전 적용"으로 확정한 AI 재작성 결과. pasteText(붙여넣기 원문)는 절대 덮어쓰지 않는다.
  const [appliedTuned, setAppliedTuned] = useState<{ title: string; body: string } | null>(null);

  const parsedPreview = pasteText.trim() ? parseExpertPickPaste(pasteText) : null;

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/expert-picks");
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

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/expert-picks/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setImageUrl(data.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드 실패");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleTune = async () => {
    if (!pasteText.trim() || !parsedPreview) return;
    setTuning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/expert-picks/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 서버 파서가 분리한 제목/본문을 각각 보낸다 — 제목 줄까지 섞어서
        // 보내면 AI가 맞춤법을 고치다 제목 줄 표현이 살짝 바뀌어 "본문 첫 줄
        // 제목 중복 제거" 매칭이 깨지는 문제가 있었다. 이제는 제목도 AI가
        // 독립적으로 새로 쓰므로 그 문제 자체가 구조적으로 사라진다.
        body: JSON.stringify({
          titleKo: parsedPreview.title,
          bodyKo: parsedPreview.body,
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setTunedPreview({ title: data.tunedTitleKo, body: data.tunedBodyKo });
      setAppliedTuned(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 재작성 실패");
    } finally {
      setTuning(false);
    }
  };

  // 원문 textarea는 그대로 두고, 발행 시 쓸 재작성 결과(제목+본문)만 확정한다.
  const applyTuned = () => {
    if (tunedPreview) setAppliedTuned(tunedPreview);
  };

  const cancelTuned = () => setAppliedTuned(null);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pasteText.trim()) {
      setError("본문을 붙여넣어 주세요");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/expert-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // bodyKoRaw는 언제나 붙여넣기 원문. titleKo/bodyKo는 AI 재작성을
          // 적용했을 때만 덮어쓴다 — 이때 제목도 원문과 다른 새 제목이 된다.
          bodyKoRaw: pasteText,
          ...(appliedTuned
            ? { titleKo: appliedTuned.title, bodyKo: appliedTuned.body, aiTuned: true }
            : { aiTuned: false }),
          imageUrl,
          authorLabel: authorLabel.trim(),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setPasteText("");
      setImageUrl("");
      setAuthorLabel("");
      setTunedPreview(null);
      setAppliedTuned(null);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (item: ExpertPickItem) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/expert-picks/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled, expectedVersion: item.version }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 변경 실패");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/expert-picks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    }
  };

  return (
    <section>
      <h2 className="text-2xl font-black tracking-tight mb-2">전문가픽 관리</h2>
      <p className="text-sm text-zinc-400 mb-6">
        카카오톡 등에서 복사한 텍스트를 그대로 붙여넣으면 첫 줄이 제목이 되고 나머지가 본문이 됩니다.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-5 flex flex-col gap-4 mb-8"
      >
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
            본문 붙여넣기 <span className="text-red-400">*</span>
          </label>
          <textarea
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400 min-h-[180px] resize-y whitespace-pre-wrap"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"첫 줄: 제목\n\n나머지 줄: 본문. 링크와 줄바꿈은 그대로 인식됩니다."}
          />
          {parsedPreview && (
            <p className="text-xs text-zinc-500 mt-1.5">
              인식된 제목: <span className="text-zinc-300">{parsedPreview.title}</span>
              {parsedPreview.linkUrl && (
                <> · 인식된 링크: <span className="text-zinc-300">{parsedPreview.linkDomain}</span></>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTune}
            disabled={tuning || !pasteText.trim()}
            className="rounded-lg border border-violet-500/60 bg-violet-500/10 px-4 py-2 text-sm text-violet-100 disabled:opacity-50"
          >
            {tuning ? "AI가 재작성하는 중..." : "✨ AI로 재작성"}
          </button>
          <p className="text-xs text-zinc-500">
            원문을 그대로 다듬는 게 아니라, 사실관계만 보존한 채 다른 문장·제목으로 다시 씁니다
            (저작권 보호 목적). 발행 전 반드시 결과를 검수해 주세요.
          </p>
        </div>

        {tunedPreview && (
          <div className="rounded-lg border border-violet-500/40 bg-zinc-950 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">
                원문
                {!appliedTuned && (
                  <span className="ml-2 text-emerald-300">· 이 버전이 발행됩니다</span>
                )}
              </p>
              <p className="text-sm text-zinc-300 font-semibold mb-1">{parsedPreview?.title}</p>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{pasteText}</p>
            </div>
            <div>
              <p className="text-xs text-violet-300 mb-1">
                AI 재작성 결과
                {appliedTuned === tunedPreview && (
                  <span className="ml-2 text-emerald-300">· 적용됨 — 이 버전이 발행됩니다</span>
                )}
              </p>
              <p className="text-sm text-violet-100 font-semibold mb-1">{tunedPreview.title}</p>
              <p className="text-sm text-zinc-100 whitespace-pre-wrap">{tunedPreview.body}</p>
              {appliedTuned === tunedPreview ? (
                <button
                  type="button"
                  onClick={cancelTuned}
                  className="mt-3 rounded-lg border border-zinc-600 text-zinc-300 hover:text-zinc-100 px-4 py-1.5 text-xs font-bold"
                >
                  적용 취소 (원문으로 발행)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyTuned}
                  className="mt-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 text-xs font-bold"
                >
                  이 버전 적용
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">대표 이미지</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleImageSelect}
            disabled={uploadingImage}
            className="text-sm text-zinc-300"
          />
          {uploadingImage && <p className="text-xs text-zinc-500 mt-1">업로드 중...</p>}
          {imageUrl && !uploadingImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="mt-2 h-24 rounded-lg object-cover" />
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">작성자 표시명 (선택)</label>
          <input
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            value={authorLabel}
            onChange={(e) => setAuthorLabel(e.target.value)}
            placeholder="예: 전문가 A"
          />
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 text-sm font-bold disabled:opacity-60"
          >
            {submitting ? "발행 중..." : "발행"}
          </button>
        </div>
      </form>

      <div>
        <h3 className="text-base font-bold text-zinc-200 mb-3">등록된 전문가픽 ({items.length}개)</h3>
        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-xs text-zinc-400 bg-zinc-900/60">
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">제목</th>
                <th className="px-3 py-3 text-center">AI다듬음</th>
                <th className="px-3 py-3 text-center">활성</th>
                <th className="px-3 py-3 text-center">삭제</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5 text-zinc-500">{item.id}</td>
                  <td className="px-3 py-2.5 text-zinc-200 font-medium">{item.title_ko}</td>
                  <td className="px-3 py-2.5 text-center">{item.ai_tuned ? "✨" : "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button type="button" onClick={() => handleToggle(item)} className="text-base leading-none">
                      {item.enabled ? "✅" : "❌"}
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
                  <td colSpan={5} className="px-3 py-10 text-center text-zinc-500 text-sm">
                    등록된 전문가픽이 없습니다
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
