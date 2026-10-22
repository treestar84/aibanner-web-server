import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import ts from "typescript";

// Render the actual server pages with a read-only fixture repository. An
// unexpected DB import/function fails immediately; tests never load credentials.
const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notFoundError = new Error("NEXT_NOT_FOUND");
const snapshot = {
  snapshot_id: "fixture-snapshot", updated_at_utc: "2026-10-23T00:00:00Z",
  next_update_at_utc: "2026-10-23T06:00:00Z",
};
const keywords = Array.from({ length: 10 }, (_, index) => ({
  snapshot_id: snapshot.snapshot_id, keyword_id: `keyword-${index + 1}`,
  keyword: `English ${index + 1}`, keyword_ko: index === 1 ? "" : `소식 ${index + 1}`,
  rank: index + 1, delta_rank: index - 2, is_new: index === 0,
  summary_short: `요약 ${index + 1}`, top_source_domain: "example.com",
  top_source_image_url: index === 1 ? null : "https://example.com/image.png",
  view_count: 100 - index,
}));
const pick = {
  id: 7, enabled: true, title_ko: "편집자의 글", body_ko: "편집자의 글\n첫 문단\n\n둘째 문단  \n",
  image_url: "https://example.com/pick.png", author_label: "편집자",
  link_url: "https://example.com/original", link_domain: "example.com",
};

type RouteProps = { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> };
type PageModule = {
  default: (props?: RouteProps) => Promise<ReactElement>;
  revalidate: number;
  generateMetadata: (props: Pick<RouteProps, "params">) => Promise<{ title: string }>;
};

function pageHarness(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const values: Record<string, unknown> = {
    getLatestSnapshotWithKeywords: snapshot, getTopKeywords: keywords,
    getKeywordInLatestSnapshot: keywords[0], getSourcesByKeyword: [],
    getHotKeywords: keywords, getActiveManualKeywordIds: new Set(),
    listExpertPicks: [pick], getExpertPickById: pick, ...overrides,
  };
  const db = Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
    async (...args: unknown[]) => { calls.push({ name, args }); return value; },
  ]));
  const cache = new Map<string, unknown>();

  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file);
    const testModule = { exports: {} };
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (id: string): unknown => {
      if (id === "@/lib/db/queries") return db;
      if (id.startsWith("@/lib/db/")) throw new Error(`Unexpected database dependency: ${id}`);
      if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) };
      if (id === "next/link") return { __esModule: true, default: (props: Record<string, unknown>) => {
        const attributes = { ...props };
        delete attributes.prefetch;
        return createElement("a", attributes);
      } };
      if (id === "next/image") return { __esModule: true, default: (props: Record<string, unknown>) => createElement("img", props) };
      if (id === "next/navigation") return { notFound: () => { throw notFoundError; } };
      if (id.startsWith("@/app/_components/")) return load(resolve(appRoot, "_components", `${id.split("/").at(-1)}.tsx`));
      if (id.startsWith("@/")) return require(resolve(appRoot, "..", `${id.slice(2)}.ts`));
      return require(id);
    };
    runInNewContext(source, { module: testModule, exports: testModule.exports, require: localRequire, process }, { filename: file });
    cache.set(file, testModule.exports);
    return testModule.exports;
  }
  return {
    calls,
    page: (route: string) => load(resolve(appRoot, route, "page.tsx")) as PageModule,
    async html(route: string, id = "keyword-1", from?: string) {
      const page = this.page(route);
      return renderToStaticMarkup(await page.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from }) }));
    },
  };
}

test("public trend page preserves query limit, order, fallbacks and all detail destinations", async () => {
  const h = pageHarness();
  const html = await h.html("app");
  assert.deepEqual(h.calls, [
    { name: "getLatestSnapshotWithKeywords", args: [] },
    { name: "getTopKeywords", args: [snapshot.snapshot_id, 10] },
  ]);
  assert.equal(h.page("app").revalidate, 120);
  let previous = -1;
  for (const kw of keywords) {
    const position = html.indexOf(`href="/k/${kw.keyword_id}"`);
    assert.ok(position > previous);
    previous = position;
    assert.ok(html.includes(kw.keyword_ko || kw.keyword));
    assert.ok(html.includes(kw.summary_short));
  }
  assert.match(html, /NEW/);
  assert.match(html, /▲1/);
  assert.match(html, /▼1/);
  assert.match(html, /class="deltaStill"/);
  assert.equal((html.match(/class="rank"/g) ?? []).length, 10);
  assert.equal((html.match(/class="trendLink"/g) ?? []).length, 10);
});

test("empty snapshots do not trigger additional keyword reads", async () => {
  for (const route of ["app", "burning"]) {
    const h = pageHarness({ getLatestSnapshotWithKeywords: null });
    assert.match(await h.html(route), /아직/);
    assert.equal(h.calls.length, 1);
  }
});

test("keyword detail preserves source groups, external URLs, metadata and burning return route", async () => {
  const sources = ["news", "social", "data"].map((type, id) => ({
    id, type, title: `출처 ${type}`, title_ko: null, domain: "example.com",
    url: `https://example.com/${type}`, image_url: "https://example.com/image.png",
    snippet: "출처 요약", published_at_utc: "2026-10-23T00:00:00Z",
  }));
  const h = pageHarness({ getSourcesByKeyword: sources });
  const html = await h.html("k/[id]", "keyword-1", "BURNING");
  assert.deepEqual(h.calls, [
    { name: "getKeywordInLatestSnapshot", args: ["keyword-1"] },
    { name: "getSourcesByKeyword", args: [snapshot.snapshot_id, "keyword-1"] },
  ]);
  assert.match(html, /href="\/burning" class="back"/);
  for (const label of ["뉴스", "소셜", "데이터"]) assert.ok(html.includes(label));
  for (const source of sources) assert.ok(html.includes(`href="${source.url}" target="_blank" rel="noopener noreferrer"`));
  assert.match(html, /https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.aitrendwidget\.ai_trend_news/);
  const metadata = await h.page("k/[id]").generateMetadata({ params: Promise.resolve({ id: "keyword-1" }) });
  assert.equal(metadata.title, "소식 1 — AI 트렌드");
  assert.equal(h.page("k/[id]").revalidate, 900);
  assert.match(await h.html("k/[id]"), /href="\/app" class="back"/);
});

test("missing keywords stay 404; missing sources retain their empty state", async () => {
  const h = pageHarness({ getKeywordInLatestSnapshot: null });
  await assert.rejects(h.html("k/[id]"), (error) => error === notFoundError);
  assert.equal(h.calls.length, 1);
  assert.match(await pageHarness().html("k/[id]"), /출처 데이터를 불러오는 중입니다/);
});

test("burning preserves lifecycle bounds, query limits and encoded return links", async () => {
  const previous = process.env.RETENTION_KEYWORD_VIEW_DAYS;
  process.env.RETENTION_KEYWORD_VIEW_DAYS = "3";
  try {
    const h = pageHarness({ getHotKeywords: [{ ...keywords[0], keyword_id: "한글 / 키워드" }] });
    const html = await h.html("burning");
    assert.deepEqual(h.calls, [
      { name: "getLatestSnapshotWithKeywords", args: ["realtime"] },
      { name: "getHotKeywords", args: [3, 100, 10, "realtime"] },
      { name: "getActiveManualKeywordIds", args: ["realtime"] },
    ]);
    assert.ok(html.includes(`/k/${encodeURIComponent("한글 / 키워드")}?from=burning`));
    assert.match(html, /100/);
    assert.equal(h.page("burning").revalidate, 60);
  } finally {
    if (previous === undefined) delete process.env.RETENTION_KEYWORD_VIEW_DAYS;
    else process.env.RETENTION_KEYWORD_VIEW_DAYS = previous;
  }
});

test("expert list preserves enabled-only limit and detail destinations", async () => {
  const h = pageHarness();
  const html = await h.html("expert-picks");
  assert.deepEqual(h.calls, [{ name: "listExpertPicks", args: [true, 50] }]);
  assert.match(html, /href="\/expert-picks\/7"/);
  assert.ok(html.includes(pick.title_ko));
  assert.equal(h.page("expert-picks").revalidate, 60);
  assert.match(await pageHarness({ listExpertPicks: [] }).html("expert-picks"), /아직 등록된 전문가픽이 없습니다/);
});

test("burning still excludes expired manual keywords and caps the visible list at 30", async () => {
  const activeId = "manual_realtime_active";
  const expiredId = "manual_realtime_expired";
  const h = pageHarness({
    getHotKeywords: [
      { ...keywords[0], keyword_id: activeId },
      { ...keywords[0], keyword_id: expiredId },
      ...Array.from({ length: 40 }, (_, index) => ({ ...keywords[0], keyword_id: `visible-${index}` })),
    ],
    getActiveManualKeywordIds: new Set([activeId]),
  });
  const html = await h.html("burning");
  assert.ok(html.includes(`/k/${activeId}?from=burning`));
  assert.ok(!html.includes(`/k/${expiredId}?from=burning`));
  assert.equal((html.match(/\?from=burning/g) ?? []).length, 30);
});

test("expert article preserves exact body whitespace and original link", async () => {
  const h = pageHarness();
  const html = await h.html("expert-picks/[id]", "7");
  assert.deepEqual(h.calls, [{ name: "getExpertPickById", args: [7] }]);
  assert.ok(html.includes('class="articleBody">첫 문단\n\n둘째 문단  \n</p>'));
  assert.ok(html.includes(`href="${pick.link_url}" target="_blank" rel="noopener noreferrer"`));
  assert.equal(h.page("expert-picks/[id]").revalidate, 900);
  for (const item of [null, { ...pick, enabled: false }]) {
    await assert.rejects(pageHarness({ getExpertPickById: item }).html("expert-picks/[id]", "7"), (error) => error === notFoundError);
  }
  const invalid = pageHarness();
  await assert.rejects(invalid.html("expert-picks/[id]", "invalid"), (error) => error === notFoundError);
  assert.equal(invalid.calls.length, 0);
});
