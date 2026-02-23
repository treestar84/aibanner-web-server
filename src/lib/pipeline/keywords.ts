import type { RssItem } from "./rss";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeywordCandidate {
  text: string;
  count: number;
  domains: Set<string>;
  latestAt: Date;
  tier: string;
}

export interface NormalizedKeyword {
  keywordId: string;   // canonical ID (slug)
  keyword: string;     // 표시용 문자열
  aliases: string[];
  candidates: KeywordCandidate;
}

// ─── Stopwords ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "update", "release", "version", "new", "latest", "using", "via",
  "open", "source", "github", "official", "blog", "post", "news",
  "week", "today", "this", "that", "with", "from", "have", "will",
  "한국", "대한", "관련", "발표", "공개", "출시", "업데이트",
]);

// ─── Rule-based normalization ─────────────────────────────────────────────────

function slugify(text: string): string {
  // ASCII 영문이면 일반 slug, 한글 등 CJK 포함 시 hex 해시로 안정적 ID 생성
  const ascii = text
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_")
    .trim();

  if (ascii.replace(/_/g, "").length >= 2) return ascii;

  // 비 ASCII 주도 텍스트 → 간단한 해시
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) >>> 0;
  }
  return `kw_${hash.toString(36)}`;
}

function isStopword(token: string): boolean {
  return STOPWORDS.has(token.toLowerCase()) || token.length <= 1;
}

function extractNgramCandidates(title: string): string[] {
  // 특수문자 정리
  const clean = title
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = clean.split(/\s+/);
  const candidates: string[] = [];

  // 2~4 gram
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const gram = tokens.slice(i, i + n).join(" ");
      // 시작/끝 stopword 제외
      if (isStopword(tokens[i]) || isStopword(tokens[i + n - 1])) continue;
      if (gram.length > 2) candidates.push(gram);
    }
  }

  // CamelCase / 연속 대문자 토큰 (모델명, 제품명)
  for (const token of tokens) {
    if (/^[A-Z][a-z]+[A-Z]/.test(token)) candidates.push(token); // CamelCase
    if (/^[A-Z]{2,}/.test(token) && token.length >= 2) candidates.push(token);
    // 모델명 패턴: GPT-4.1, Qwen2.5, Claude-3.5
    if (/[A-Za-z][-.]?\d+(\.\d+)?/.test(token)) candidates.push(token);
  }

  return [...new Set(candidates)].filter((c) => !STOPWORDS.has(c.toLowerCase()));
}

// ─── Step 1: Extract candidates from RSS items ────────────────────────────────

export function extractCandidates(
  items: RssItem[]
): Map<string, KeywordCandidate> {
  const candidateMap = new Map<string, KeywordCandidate>();

  for (const item of items) {
    const rawCandidates = extractNgramCandidates(item.title);
    for (const candidate of rawCandidates) {
      const key = candidate.toLowerCase().replace(/\s+/g, "_");
      const existing = candidateMap.get(key);
      if (existing) {
        existing.count++;
        existing.domains.add(item.sourceDomain);
        if (item.publishedAt > existing.latestAt) {
          existing.latestAt = item.publishedAt;
        }
      } else {
        candidateMap.set(key, {
          text: candidate,
          count: 1,
          domains: new Set([item.sourceDomain]),
          latestAt: item.publishedAt,
          tier: item.tier,
        });
      }
    }
  }

  return candidateMap;
}

// ─── Step 2: AI-based clustering (aliases → canonical) ───────────────────────

const CLUSTER_PROMPT = `You are an AI keyword normalization engine.
Given a list of keyword candidates extracted from AI news titles, group them into clusters of the same concept.
Each cluster should have:
- "canonical": the best display name (proper capitalization, e.g. "GPT-4o", "Claude 3.5 Sonnet")
- "aliases": list of all variant strings in the group

Rules:
- Only group keywords that clearly refer to the SAME product/model/concept
- Keep different models separate (GPT-4o ≠ GPT-4 Turbo)
- Return valid JSON array only, no markdown

Example output:
[
  {"canonical": "GPT-4o", "aliases": ["GPT 4o", "gpt-4o", "GPT4o"]},
  {"canonical": "Claude 3.5 Sonnet", "aliases": ["claude-3.5-sonnet", "Claude 3.5"]}
]`;

interface ClusterResult {
  canonical: string;
  aliases: string[];
}

export async function clusterKeywords(
  candidates: string[]
): Promise<ClusterResult[]> {
  if (candidates.length === 0) return [];

  const client = new OpenAI();
  const batch = candidates.slice(0, 80).join("\n"); // 한 번에 최대 80개

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: CLUSTER_PROMPT },
        { role: "user", content: batch },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content ?? "[]";
    // JSON 배열 추출 (마크다운 코드블록 감싸는 경우도 처리)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    const clusters: ClusterResult[] = Array.isArray(parsed) ? parsed : [];
    return clusters.filter((c) => c.canonical && Array.isArray(c.aliases));
  } catch (err) {
    console.warn("[keywords] AI clustering failed, using raw candidates:", err);
    // fallback: 각 후보를 그대로 반환
    return candidates.map((c) => ({ canonical: c, aliases: [c] }));
  }
}

// ─── Step 3: Merge candidates with clusters ───────────────────────────────────

export async function normalizeKeywords(
  items: RssItem[]
): Promise<NormalizedKeyword[]> {
  const candidateMap = extractCandidates(items);

  // count 기준 정렬 후 상위 60개만 AI 클러스터링으로 전달
  const filtered = Array.from(candidateMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 60)
    .map((v) => v.text);

  const clusters = await clusterKeywords(filtered);

  const result: NormalizedKeyword[] = [];

  for (const cluster of clusters) {
    const keywordId = slugify(cluster.canonical);
    // 원본 후보 데이터 찾기 (canonical 또는 alias로 lookup)
    const allAliases = [cluster.canonical, ...cluster.aliases];
    let mergedCandidate: KeywordCandidate = {
      text: cluster.canonical,
      count: 0,
      domains: new Set(),
      latestAt: new Date(0),
      tier: "P2_RAW",
    };

    for (const alias of allAliases) {
      const key = alias.toLowerCase().replace(/\s+/g, "_");
      const found = candidateMap.get(key);
      if (found) {
        mergedCandidate.count += found.count;
        found.domains.forEach((d) => mergedCandidate.domains.add(d));
        if (found.latestAt > mergedCandidate.latestAt) {
          mergedCandidate.latestAt = found.latestAt;
        }
        if (
          found.tier === "P0_CURATED" ||
          found.tier === "P0_RELEASES"
        ) {
          mergedCandidate.tier = found.tier;
        }
      }
    }

    if (mergedCandidate.count === 0) continue;

    result.push({
      keywordId,
      keyword: cluster.canonical,
      aliases: cluster.aliases,
      candidates: mergedCandidate,
    });
  }

  return result;
}
