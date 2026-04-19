"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

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

function generateSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || `promo-${Date.now()}`;
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

  // 최소 입력 필드: 제목, 본문, 이미지
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/promo-contents");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setError("Failed to fetch promo contents");
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleSubmit = async (e: FormEvent) => {
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
      const maxSort = items.length > 0
        ? Math.max(...items.map((i) => i.sort_order))
        : -1;

      const res = await fetch("/api/admin/promo-contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: generateSlug(title),
          titleKo: title.trim(),
          subtitleKo: subtitle,
          bodyKo: body.trim(),
          imageUrl: imageUrl.trim(),
          sortOrder: maxSort + 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error"); return; }
      setTitle(""); setBody(""); setImageUrl("");
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

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6,
    fontSize: 14, width: "100%", boxSizing: "border-box",
    color: "#111827", backgroundColor: "#fff",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block", color: "#111827",
  };

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
        프로모션 관리
      </h2>

      {error && (
        <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div>
          <label style={labelStyle}>제목 *</label>
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="프로모션 제목을 입력하세요" />
        </div>
        <div>
          <label style={labelStyle}>본문 *</label>
          <textarea style={{ ...inputStyle, minHeight: 100 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="프로모션 내용을 입력하세요 (첫 문장이 부제목으로 사용됩니다)" />
        </div>
        <div>
          <label style={labelStyle}>이미지 URL</label>
          <input style={inputStyle} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div style={{ textAlign: "right" }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 28px", background: "#7C3AED", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "등록 중..." : "등록"}
          </button>
        </div>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "8px 6px" }}>#</th>
            <th style={{ padding: "8px 6px" }}>태그</th>
            <th style={{ padding: "8px 6px" }}>제목</th>
            <th style={{ padding: "8px 6px" }}>순서</th>
            <th style={{ padding: "8px 6px" }}>활성</th>
            <th style={{ padding: "8px 6px" }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px 6px" }}>{item.id}</td>
              <td style={{ padding: "8px 6px" }}>
                <span style={{ background: item.tag_color, color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                  {item.tag}
                </span>
              </td>
              <td style={{ padding: "8px 6px" }}>{item.title_ko}</td>
              <td style={{ padding: "8px 6px" }}>{item.sort_order}</td>
              <td style={{ padding: "8px 6px" }}>
                <button
                  onClick={() => handleToggle(item.id, item.enabled)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16 }}
                >
                  {item.enabled ? "✅" : "❌"}
                </button>
              </td>
              <td style={{ padding: "8px 6px" }}>
                <button
                  onClick={() => handleDelete(item.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#dc2626" }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#9ca3af" }}>
                등록된 프로모션이 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
