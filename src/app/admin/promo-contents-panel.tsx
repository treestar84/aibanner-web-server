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

export function PromoContentsPanel() {
  const [items, setItems] = useState<PromoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // form fields
  const [slug, setSlug] = useState("");
  const [tag, setTag] = useState("INFO");
  const [tagColor, setTagColor] = useState("#7C3AED");
  const [titleKo, setTitleKo] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [subtitleKo, setSubtitleKo] = useState("");
  const [subtitleEn, setSubtitleEn] = useState("");
  const [bodyKo, setBodyKo] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [gradientFrom, setGradientFrom] = useState("#7C3AED");
  const [gradientTo, setGradientTo] = useState("#4F46E5");
  const [iconName, setIconName] = useState("info");
  const [linkUrl, setLinkUrl] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

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
    if (!slug.trim() || !titleKo.trim() || !titleEn.trim()) {
      setError("slug, 제목(ko), 제목(en) 필수");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/promo-contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, tag, tagColor, titleKo, titleEn,
          subtitleKo, subtitleEn, bodyKo, bodyEn,
          imageUrl, gradientFrom, gradientTo, iconName, linkUrl, sortOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error"); return; }
      // reset form
      setSlug(""); setTitleKo(""); setTitleEn("");
      setSubtitleKo(""); setSubtitleEn("");
      setBodyKo(""); setBodyEn("");
      setImageUrl(""); setLinkUrl("");
      setSortOrder(0);
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
    padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6,
    fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, marginBottom: 2, display: "block", color: "#555",
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

      <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div>
          <label style={labelStyle}>Slug (URL용)</label>
          <input style={inputStyle} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="claude-code-meetup" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>태그</label>
            <input style={inputStyle} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="EVENT" />
          </div>
          <div>
            <label style={labelStyle}>태그 색상</label>
            <input style={inputStyle} type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>순서</label>
            <input style={inputStyle} type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>제목 (ko)</label>
          <input style={inputStyle} value={titleKo} onChange={(e) => setTitleKo(e.target.value)} placeholder="Claude Code Meetup 판교" />
        </div>
        <div>
          <label style={labelStyle}>제목 (en)</label>
          <input style={inputStyle} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="Claude Code Meetup Pangyo" />
        </div>
        <div>
          <label style={labelStyle}>부제목 (ko)</label>
          <input style={inputStyle} value={subtitleKo} onChange={(e) => setSubtitleKo(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>부제목 (en)</label>
          <input style={inputStyle} value={subtitleEn} onChange={(e) => setSubtitleEn(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>본문 (ko)</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={bodyKo} onChange={(e) => setBodyKo(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>본문 (en)</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>이미지 URL</label>
          <input style={inputStyle} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div>
          <label style={labelStyle}>외부 링크 URL</label>
          <input style={inputStyle} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>그라데이션 From</label>
            <input style={inputStyle} type="color" value={gradientFrom} onChange={(e) => setGradientFrom(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>그라데이션 To</label>
            <input style={inputStyle} type="color" value={gradientTo} onChange={(e) => setGradientTo(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>아이콘명</label>
            <input style={inputStyle} value={iconName} onChange={(e) => setIconName(e.target.value)} placeholder="groups" />
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1", textAlign: "right" }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "8px 24px", background: "#7C3AED", color: "#fff",
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
