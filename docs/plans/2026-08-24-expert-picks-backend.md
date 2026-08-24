# Expert Picks (전문가픽) Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually-curated "Expert Picks" content type to the web-server: DB table, admin CRUD API (paste-to-publish + optional AI tuning + image upload), and a public read API, following the existing `promo_contents` patterns exactly.

**Architecture:** New `expert_picks` Postgres table alongside a `expert_pick_view_events` dedup table (mirrors `keyword_view_events`). Admin routes under `/api/admin/expert-picks/*` reuse the existing `requireAdminRequest`/middleware Basic Auth gate. Public routes under `/api/v1/expert-picks/*` reuse the existing IP rate limiter. A pure parsing module (`expert-picks-parser.ts`) extracts title/link from pasted text with zero framework dependencies, so it is unit-testable without a DB or HTTP mocking.

**Tech Stack:** Next.js 15 (App Router, route handlers), `@neondatabase/serverless` tagged-template SQL, `openai` SDK (`gpt-4o-mini`), new dependency `@vercel/blob` for image storage, `node --test` + `node:assert/strict` for tests (project convention — no Jest/Vitest).

**Spec:** `/Users/treestar/dev/realtime-ai-trend-news/docs/superpowers/specs/2026-08-24-expert-picks-design.md`

## Global Constraints

- Follow the existing `promo_contents` CRUD pattern exactly (see `src/app/api/admin/promo-contents/*`, `src/lib/db/queries.ts` promo section, `src/app/api/v1/promos/route.ts`) — do not invent a new admin-auth or rate-limit mechanism.
- Never trim or collapse internal newlines in `body_ko`/`body_ko_raw` anywhere in the backend — only `.trim()` leading/trailing whitespace of the whole string is allowed.
- `body_ko_raw` is written once at creation and never overwritten by the tune-apply flow.
- All admin routes must call `requireAdminRequest(req)` at the top (defense in depth — middleware also gates `/api/admin/*`, but routes must not rely on middleware alone, per the existing code comment in `admin-auth.ts`).
- Tests follow this repo's existing style: plain `node:test` + `node:assert/strict`, no test framework config changes.
- Run `npm test` and `npm run lint` before every commit that touches `src/`.

---

## Task 1: DB schema — `expert_picks` and `expert_pick_view_events` tables

**Files:**
- Modify: `src/lib/db/schema.sql` (append new section after the `promo_contents` block, ~line 471)
- Test: `src/lib/db/schema.test.ts` (new)

**Interfaces:**
- Produces: SQL tables `expert_picks(id, title_ko, title_en, body_ko, body_en, body_ko_raw, ai_tuned, image_url, link_url, link_domain, author_label, sort_order, enabled, view_count, last_viewed_at, created_at, updated_at)` and `expert_pick_view_events(expert_pick_id, viewer_hash, bucket_start, created_at)`.

- [ ] **Step 1: Write the failing schema contract test**

```typescript
// src/lib/db/schema.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
);

test("schema defines expert_picks table with raw-body and ai-tuned columns", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS expert_picks/);
  assert.match(schemaSource, /body_ko_raw\s+TEXT\s+NOT NULL/);
  assert.match(schemaSource, /ai_tuned\s+BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  assert.match(schemaSource, /view_count\s+BIGINT\s+NOT NULL DEFAULT 0/);
});

test("schema defines expert_pick_view_events dedup table with composite PK", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS expert_pick_view_events/);
  assert.match(
    schemaSource,
    /PRIMARY KEY \(expert_pick_id, viewer_hash, bucket_start\)/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/db/schema.test.ts`
Expected: FAIL — both `assert.match` calls fail because the tables don't exist yet.

- [ ] **Step 3: Append the schema section**

Add this block to `src/lib/db/schema.sql`, immediately after the `promo_contents` section (after the `idx_promo_contents_enabled_sort` index, before the `app_config` section):

```sql
-- ============================================================
-- expert_picks: 전문가픽 콘텐츠 (관리자 수동 큐레이션)
-- ============================================================
CREATE TABLE IF NOT EXISTS expert_picks (
  id             SERIAL      PRIMARY KEY,
  title_ko       TEXT        NOT NULL,
  title_en       TEXT        NOT NULL DEFAULT '',
  body_ko        TEXT        NOT NULL,
  body_en        TEXT        NOT NULL DEFAULT '',
  body_ko_raw    TEXT        NOT NULL,
  ai_tuned       BOOLEAN     NOT NULL DEFAULT FALSE,
  image_url      TEXT        NOT NULL DEFAULT '',
  link_url       TEXT        NOT NULL DEFAULT '',
  link_domain    TEXT        NOT NULL DEFAULT '',
  author_label   TEXT        NOT NULL DEFAULT '',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  view_count     BIGINT      NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expert_picks_enabled_sort
  ON expert_picks(enabled, sort_order DESC, created_at DESC);

-- 익명화된 조회 중복 방지 토큰. IP나 원문 User-Agent는 저장하지 않는다.
CREATE TABLE IF NOT EXISTS expert_pick_view_events (
  expert_pick_id INTEGER     NOT NULL,
  viewer_hash    TEXT        NOT NULL,
  bucket_start   TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (expert_pick_id, viewer_hash, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_expert_pick_view_events_created_at
  ON expert_pick_view_events(created_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Apply the migration against the dev database**

Run: `npm run db:migrate`
Expected: Output includes `✅ Executed: CREATE TABLE IF NOT EXISTS expert_picks...` and `✅ Migration complete.` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.sql src/lib/db/schema.test.ts
git commit -m "feat(db): add expert_picks and expert_pick_view_events tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Paste-parsing utility (title/link extraction)

**Files:**
- Create: `src/lib/expert-picks-parser.ts`
- Test: `src/lib/expert-picks-parser.test.ts`

**Interfaces:**
- Produces:
  - `parseExpertPickPaste(raw: string): { title: string; body: string; linkUrl: string; linkDomain: string }`
  - `extractLinkDomain(url: string): string`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/expert-picks-parser.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseExpertPickPaste, extractLinkDomain } from "./expert-picks-parser";

test("uses the first non-empty line as title, keeps full body with newlines intact", () => {
  const raw = "GPT-5.5 출시 임박\n\n오픈AI가 다음 주 발표를 예고했다.\n관련 링크: https://example.com/news?utm_source=kakao";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title, "GPT-5.5 출시 임박");
  assert.equal(result.body, raw.trim());
  assert.equal(result.linkUrl, "https://example.com/news?utm_source=kakao");
  assert.equal(result.linkDomain, "example.com");
});

test("skips leading blank lines to find the title", () => {
  const raw = "\n\n  \n첫 유효 줄이 제목\n본문 내용";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title, "첫 유효 줄이 제목");
});

test("truncates an overlong title to 100 chars without touching the body", () => {
  const longLine = "가".repeat(150);
  const raw = `${longLine}\n본문`;
  const result = parseExpertPickPaste(raw);
  assert.equal(result.title.length, 100);
  assert.match(result.body, new RegExp(`^${longLine}`));
});

test("preserves multiple consecutive blank lines inside the body verbatim", () => {
  const raw = "제목\n\n\n\n중간에 빈 줄 여러 개\n\n마지막 문단";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.body, raw.trim());
});

test("returns empty link fields when no URL is present", () => {
  const result = parseExpertPickPaste("제목만 있는 글\n링크 없음");
  assert.equal(result.linkUrl, "");
  assert.equal(result.linkDomain, "");
});

test("picks the first of multiple URLs in the body", () => {
  const raw = "제목\nhttps://first.example.com/a\n더 보기 https://second.example.com/b";
  const result = parseExpertPickPaste(raw);
  assert.equal(result.linkUrl, "https://first.example.com/a");
});

test("extractLinkDomain returns hostname for valid URLs and empty string for invalid input", () => {
  assert.equal(extractLinkDomain("https://sub.example.com/path"), "sub.example.com");
  assert.equal(extractLinkDomain("not a url"), "");
  assert.equal(extractLinkDomain(""), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/expert-picks-parser.test.ts`
Expected: FAIL with "Cannot find module './expert-picks-parser'"

- [ ] **Step 3: Implement the parser**

```typescript
// src/lib/expert-picks-parser.ts
const TITLE_MAX_CHARS = 100;
const URL_PATTERN = /https?:\/\/[^\s<>"'\)\]]+/;

export function extractLinkDomain(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function parseExpertPickPaste(raw: string): {
  title: string;
  body: string;
  linkUrl: string;
  linkDomain: string;
} {
  const body = raw.trim();

  const firstNonEmptyLine =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const title = firstNonEmptyLine.slice(0, TITLE_MAX_CHARS);

  const linkMatch = body.match(URL_PATTERN);
  const linkUrl = linkMatch ? linkMatch[0] : "";
  const linkDomain = extractLinkDomain(linkUrl);

  return { title, body, linkUrl, linkDomain };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/expert-picks-parser.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/expert-picks-parser.ts src/lib/expert-picks-parser.test.ts
git commit -m "feat: add expert-picks paste parser (title/link extraction)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `queries.ts` — CRUD + view tracking for expert picks

**Files:**
- Modify: `src/lib/db/queries.ts` (append new section at end of file, after the existing `claimKeywordViewEvent` area is fine — add as new bottom section)
- Test: `src/lib/db/expert-picks-query-contract.test.ts` (new, source-grep contract test following the `manual-youtube-query-contract.test.ts` pattern used in this repo — no live DB in unit tests)

**Interfaces:**
- Consumes: `sql` from `./client` (already imported at top of `queries.ts`).
- Produces:
  - `interface ExpertPick { id: number; title_ko: string; title_en: string; body_ko: string; body_en: string; body_ko_raw: string; ai_tuned: boolean; image_url: string; link_url: string; link_domain: string; author_label: string; sort_order: number; enabled: boolean; view_count: number; last_viewed_at: string; created_at: string; updated_at: string; }`
  - `listExpertPicks(enabledOnly = false): Promise<ExpertPick[]>`
  - `getExpertPickMaxUpdatedAt(): Promise<string | null>`
  - `insertExpertPick(input: {...}): Promise<ExpertPick>`
  - `updateExpertPick(id: number, expectedUpdatedAt: string, input: {...}): Promise<ExpertPick | "not_found" | "conflict">`
  - `deleteExpertPick(id: number): Promise<boolean>`
  - `incrementExpertPickViewCount(id: number): Promise<void>`
  - `claimExpertPickViewEvent(id: number, viewerHash: string, bucketStart: Date): Promise<boolean>`

- [ ] **Step 1: Write the failing contract test**

```typescript
// src/lib/db/expert-picks-query-contract.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queriesSource = readFileSync(
  new URL("./queries.ts", import.meta.url),
  "utf8",
);

test("updateExpertPick uses optimistic locking on updated_at", () => {
  assert.match(
    queriesSource,
    /WHERE id = \$\{id\} AND updated_at = \$\{expectedUpdatedAt\}/,
    "update must be scoped to the exact updated_at the client last read, or it must silently overwrite concurrent edits",
  );
});

test("insertExpertPick never writes to body_ko_raw from a later update", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_picks \(/,
  );
  // updateExpertPick's SET list must not include body_ko_raw at all —
  // the raw original is immutable after creation.
  const updateFnMatch = queriesSource.match(
    /export async function updateExpertPick[\s\S]*?\n}\n/,
  );
  assert.ok(updateFnMatch, "updateExpertPick function not found");
  assert.doesNotMatch(updateFnMatch![0], /body_ko_raw\s*=/);
});

test("claimExpertPickViewEvent uses ON CONFLICT DO NOTHING for dedup", () => {
  assert.match(
    queriesSource,
    /INSERT INTO expert_pick_view_events[\s\S]*?ON CONFLICT \(expert_pick_id, viewer_hash, bucket_start\) DO NOTHING/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/db/expert-picks-query-contract.test.ts`
Expected: FAIL — none of the matched source patterns exist yet.

- [ ] **Step 3: Implement the queries**

Append to `src/lib/db/queries.ts`:

```typescript
// ─── Expert picks queries ────────────────────────────────────────────────────

export interface ExpertPick {
  id: number;
  title_ko: string;
  title_en: string;
  body_ko: string;
  body_en: string;
  body_ko_raw: string;
  ai_tuned: boolean;
  image_url: string;
  link_url: string;
  link_domain: string;
  author_label: string;
  sort_order: number;
  enabled: boolean;
  view_count: number;
  last_viewed_at: string;
  created_at: string;
  updated_at: string;
}

export async function listExpertPicks(
  enabledOnly = false,
): Promise<ExpertPick[]> {
  const rows = enabledOnly
    ? await sql`
        SELECT * FROM expert_picks
        WHERE enabled = TRUE
        ORDER BY sort_order DESC, created_at DESC
      `
    : await sql`
        SELECT * FROM expert_picks
        ORDER BY sort_order DESC, created_at DESC
      `;
  return rows as ExpertPick[];
}

export async function getExpertPickById(id: number): Promise<ExpertPick | null> {
  const rows = await sql`SELECT * FROM expert_picks WHERE id = ${id}`;
  return (rows as ExpertPick[])[0] ?? null;
}

export async function getExpertPickMaxUpdatedAt(): Promise<string | null> {
  const rows = await sql`
    SELECT MAX(updated_at) AS max_updated_at
    FROM expert_picks
    WHERE enabled = TRUE
  `;
  return (
    (rows as { max_updated_at: string | null }[])[0]?.max_updated_at ?? null
  );
}

export async function insertExpertPick(input: {
  titleKo: string;
  titleEn: string;
  bodyKo: string;
  bodyEn: string;
  bodyKoRaw: string;
  imageUrl: string;
  linkUrl: string;
  linkDomain: string;
  authorLabel: string;
  sortOrder: number;
}): Promise<ExpertPick> {
  const rows = await sql`
    INSERT INTO expert_picks (
      title_ko, title_en, body_ko, body_en, body_ko_raw,
      image_url, link_url, link_domain, author_label, sort_order
    ) VALUES (
      ${input.titleKo}, ${input.titleEn}, ${input.bodyKo}, ${input.bodyEn}, ${input.bodyKoRaw},
      ${input.imageUrl}, ${input.linkUrl}, ${input.linkDomain}, ${input.authorLabel}, ${input.sortOrder}
    )
    RETURNING *
  `;
  return (rows as ExpertPick[])[0];
}

export async function updateExpertPick(
  id: number,
  expectedUpdatedAt: string,
  input: {
    titleKo?: string;
    titleEn?: string;
    bodyKo?: string;
    bodyEn?: string;
    aiTuned?: boolean;
    imageUrl?: string;
    linkUrl?: string;
    linkDomain?: string;
    authorLabel?: string;
    sortOrder?: number;
    enabled?: boolean;
  },
): Promise<ExpertPick | "not_found" | "conflict"> {
  const existing = await getExpertPickById(id);
  if (!existing) return "not_found";

  const rows = await sql`
    UPDATE expert_picks SET
      title_ko     = COALESCE(${input.titleKo ?? null}, title_ko),
      title_en     = COALESCE(${input.titleEn ?? null}, title_en),
      body_ko      = COALESCE(${input.bodyKo ?? null}, body_ko),
      body_en      = COALESCE(${input.bodyEn ?? null}, body_en),
      ai_tuned     = COALESCE(${input.aiTuned ?? null}, ai_tuned),
      image_url    = COALESCE(${input.imageUrl ?? null}, image_url),
      link_url     = COALESCE(${input.linkUrl ?? null}, link_url),
      link_domain  = COALESCE(${input.linkDomain ?? null}, link_domain),
      author_label = COALESCE(${input.authorLabel ?? null}, author_label),
      sort_order   = COALESCE(${input.sortOrder ?? null}, sort_order),
      enabled      = COALESCE(${input.enabled ?? null}, enabled),
      updated_at   = NOW()
    WHERE id = ${id} AND updated_at = ${expectedUpdatedAt}
    RETURNING *
  `;
  const updated = (rows as ExpertPick[])[0];
  return updated ?? "conflict";
}

export async function deleteExpertPick(id: number): Promise<boolean> {
  const rows = await sql`
    DELETE FROM expert_picks WHERE id = ${id} RETURNING id
  `;
  return (rows as { id: number }[]).length > 0;
}

export async function incrementExpertPickViewCount(id: number): Promise<void> {
  await sql`
    UPDATE expert_picks SET
      view_count = view_count + 1,
      last_viewed_at = NOW(),
      updated_at = updated_at
    WHERE id = ${id}
  `;
}

export async function incrementExpertPickViewCountBatch(
  ids: number[],
): Promise<void> {
  const normalized = [...new Set(ids)];
  if (!normalized.length) return;
  await Promise.all(normalized.map((id) => incrementExpertPickViewCount(id)));
}

export async function claimExpertPickViewEvent(
  id: number,
  viewerHash: string,
  bucketStart: Date,
): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO expert_pick_view_events (expert_pick_id, viewer_hash, bucket_start)
    VALUES (${id}, ${viewerHash}, ${bucketStart.toISOString()})
    ON CONFLICT (expert_pick_id, viewer_hash, bucket_start) DO NOTHING
    RETURNING expert_pick_id
  `) as { expert_pick_id: number }[];
  return rows.length > 0;
}
```

Note: `updateExpertPick`'s `UPDATE ... SET updated_at = updated_at` in `incrementExpertPickViewCount` is intentional — a view does not count as a content edit, so it must NOT bump `updated_at` (that would spuriously invalidate concurrent admin edits' optimistic lock and break the `If-Modified-Since` cache header on the public list endpoint).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/db/expert-picks-query-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check nothing broke**

Run: `npm test`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries.ts src/lib/db/expert-picks-query-contract.test.ts
git commit -m "feat(db): add expert_picks CRUD and view-tracking queries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Admin API — list/create (`/api/admin/expert-picks`)

**Files:**
- Create: `src/app/api/admin/expert-picks/route.ts`
- Test: `src/app/api/admin/expert-picks/route.test.ts`

**Interfaces:**
- Consumes: `requireAdminRequest` from `@/lib/admin-auth`; `listExpertPicks`, `insertExpertPick` from `@/lib/db/queries`; `parseExpertPickPaste` from `@/lib/expert-picks-parser`.
- Produces: `GET` → `{ items: ExpertPick[], count: number }`; `POST` → `{ ok: true, item: ExpertPick }` or `{ error }`.

- [ ] **Step 1: Write the failing contract test**

```typescript
// src/app/api/admin/expert-picks/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("GET and POST both call requireAdminRequest before touching the DB", () => {
  const getFn = routeSource.match(/export async function GET[\s\S]*?\n}\n/)![0];
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(getFn, /requireAdminRequest\(req\)/);
  assert.match(postFn, /requireAdminRequest\(req\)/);
});

test("POST rejects a paste with no non-empty line for a title", () => {
  assert.match(routeSource, /if \(!parsed\.title\)/);
});

test("POST uses parseExpertPickPaste to derive title/link, never trusts a raw client-sent title", () => {
  assert.match(routeSource, /parseExpertPickPaste\(rawBody\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/app/api/admin/expert-picks/route.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/admin/expert-picks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listExpertPicks, insertExpertPick } from "@/lib/db/queries";
import { requireAdminRequest } from "@/lib/admin-auth";
import { parseExpertPickPaste } from "@/lib/expert-picks-parser";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    const items = await listExpertPicks(false);
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("[/api/admin/expert-picks][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // 서버가 항상 붙여넣기 원문에서 제목/링크를 재파싱한다.
    // 클라이언트가 보낸 title/linkUrl은 "관리자가 고급 설정에서 수동 보정한 값"으로만 받아들인다.
    const rawBody = typeof body.bodyKoRaw === "string" ? body.bodyKoRaw : "";
    if (!rawBody.trim()) {
      return NextResponse.json({ error: "bodyKoRaw is required" }, { status: 400 });
    }
    const parsed = parseExpertPickPaste(rawBody);
    if (!parsed.title) {
      return NextResponse.json(
        { error: "본문에서 제목으로 쓸 첫 줄을 찾을 수 없습니다" },
        { status: 400 },
      );
    }

    const titleKo = typeof body.titleKo === "string" && body.titleKo.trim()
      ? body.titleKo.trim()
      : parsed.title;
    const linkUrl = typeof body.linkUrl === "string" && body.linkUrl.trim()
      ? body.linkUrl.trim()
      : parsed.linkUrl;
    const linkDomain = typeof body.linkDomain === "string" && body.linkDomain.trim()
      ? body.linkDomain.trim()
      : parsed.linkDomain;

    const maxSort = await listExpertPicks(false).then((items) =>
      items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : -1,
    );

    const item = await insertExpertPick({
      titleKo,
      titleEn: typeof body.titleEn === "string" ? body.titleEn : "",
      bodyKo: parsed.body,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : "",
      bodyKoRaw: parsed.body,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
      linkUrl,
      linkDomain,
      authorLabel: typeof body.authorLabel === "string" ? body.authorLabel : "",
      sortOrder: maxSort + 1,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/app/api/admin/expert-picks/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/expert-picks/route.ts src/app/api/admin/expert-picks/route.test.ts
git commit -m "feat(admin-api): add expert-picks list/create endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Admin API — update/delete with optimistic locking (`/api/admin/expert-picks/[id]`)

**Files:**
- Create: `src/app/api/admin/expert-picks/[id]/route.ts`
- Test: `src/app/api/admin/expert-picks/[id]/route.test.ts`

**Interfaces:**
- Consumes: `updateExpertPick`, `deleteExpertPick` from `@/lib/db/queries`; `requireAdminRequest` from `@/lib/admin-auth`.
- Produces: `PUT` → `{ ok: true, item }` / `409 { error: "conflict" }` / `404`; `DELETE` → `{ ok: true }` / `404`.

- [ ] **Step 1: Write the failing contract test**

```typescript
// src/app/api/admin/expert-picks/[id]/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("PUT requires expectedUpdatedAt and returns 409 on conflict", () => {
  assert.match(routeSource, /expectedUpdatedAt/);
  assert.match(routeSource, /status:\s*409/);
});

test("PUT and DELETE both call requireAdminRequest", () => {
  const putFn = routeSource.match(/export async function PUT[\s\S]*?\n}\n/)![0];
  const deleteFn = routeSource.match(/export async function DELETE[\s\S]*?\n}\n/)![0];
  assert.match(putFn, /requireAdminRequest\(req\)/);
  assert.match(deleteFn, /requireAdminRequest\(req\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/[id]/route.test.ts"`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/admin/expert-picks/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateExpertPick, deleteExpertPick } from "@/lib/db/queries";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.expectedUpdatedAt !== "string") {
      return NextResponse.json(
        { error: "expectedUpdatedAt is required for optimistic locking" },
        { status: 400 },
      );
    }

    const result = await updateExpertPick(id, body.expectedUpdatedAt, {
      titleKo: typeof body.titleKo === "string" ? body.titleKo : undefined,
      titleEn: typeof body.titleEn === "string" ? body.titleEn : undefined,
      bodyKo: typeof body.bodyKo === "string" ? body.bodyKo : undefined,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : undefined,
      aiTuned: typeof body.aiTuned === "boolean" ? body.aiTuned : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
      linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : undefined,
      linkDomain: typeof body.linkDomain === "string" ? body.linkDomain : undefined,
      authorLabel: typeof body.authorLabel === "string" ? body.authorLabel : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });

    if (result === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result === "conflict") {
      return NextResponse.json(
        { error: "다른 곳에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 재시도하세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, item: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/[id]][PUT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const deleted = await deleteExpertPick(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/expert-picks/[id]][DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/[id]/route.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/expert-picks/[id]/route.ts" "src/app/api/admin/expert-picks/[id]/route.test.ts"
git commit -m "feat(admin-api): add expert-picks update/delete with optimistic locking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Image upload endpoint (Vercel Blob)

**Files:**
- Modify: `package.json` (add `@vercel/blob` dependency)
- Modify: `.env.example` (document `BLOB_READ_WRITE_TOKEN`)
- Create: `src/app/api/admin/expert-picks/upload-image/route.ts`
- Test: `src/app/api/admin/expert-picks/upload-image/route.test.ts`

**Interfaces:**
- Produces: `POST` (multipart/form-data, field `file`) → `{ ok: true, imageUrl: string }` or `{ error }`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @vercel/blob`
Expected: `package.json`/`package-lock.json` updated, no install errors.

- [ ] **Step 2: Document the env var**

Add to `.env.example`, near the other storage-related comments:

```
# 전문가픽 대표 이미지 업로드 저장소 (Vercel Blob)
# Vercel 대시보드 > Storage > Create Database > Blob 에서 생성하면 자동 발급됨
# BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 3: Write the failing contract test**

```typescript
// src/app/api/admin/expert-picks/upload-image/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("upload-image validates MIME type against a whitelist", () => {
  assert.match(routeSource, /ALLOWED_MIME_TYPES/);
  assert.match(routeSource, /image\/jpeg/);
  assert.match(routeSource, /image\/png/);
  assert.match(routeSource, /image\/webp/);
});

test("upload-image enforces a max file size", () => {
  assert.match(routeSource, /MAX_FILE_SIZE_BYTES/);
});

test("upload-image requires admin auth", () => {
  const postFn = routeSource.match(/export async function POST[\s\S]*?\n}\n/)![0];
  assert.match(postFn, /requireAdminRequest\(req\)/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/upload-image/route.test.ts"`
Expected: FAIL — file doesn't exist.

- [ ] **Step 5: Implement the route**

```typescript
// src/app/api/admin/expert-picks/upload-image/route.ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const revalidate = 0;

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "Image storage is not configured on server" },
        { status: 503 },
      );
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Image exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit` },
        { status: 400 },
      );
    }

    const extension = file.type.split("/")[1] ?? "jpg";
    const blob = await put(
      `expert-picks/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
      file,
      { access: "public", contentType: file.type },
    );

    return NextResponse.json({ ok: true, imageUrl: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/upload-image][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/upload-image/route.test.ts"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example "src/app/api/admin/expert-picks/upload-image/route.ts" "src/app/api/admin/expert-picks/upload-image/route.test.ts"
git commit -m "feat(admin-api): add Vercel Blob image upload for expert picks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: AI tuning endpoint

**Files:**
- Create: `src/lib/expert-picks-tuning.ts`
- Create: `src/app/api/admin/expert-picks/tune/route.ts`
- Test: `src/lib/expert-picks-tuning.test.ts`
- Test: `src/app/api/admin/expert-picks/tune/route.test.ts`

**Interfaces:**
- Produces:
  - `buildTuningPrompt(bodyKo: string): { system: string; user: string }` (pure function, unit-testable without hitting OpenAI)
  - `POST /api/admin/expert-picks/tune { bodyKo: string, includeEnglish?: boolean }` → `{ ok: true, tunedKo: string, tunedEn?: string }`

- [ ] **Step 1: Write the failing prompt-builder test**

```typescript
// src/lib/expert-picks-tuning.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildTuningPrompt } from "./expert-picks-tuning";

test("tuning prompt instructs the model to preserve facts and paragraph structure", () => {
  const { system } = buildTuningPrompt("아무 텍스트");
  assert.match(system, /사실|fact/i);
  assert.match(system, /줄바꿈|paragraph/i);
});

test("tuning prompt embeds the original body verbatim in the user message", () => {
  const bodyKo = "오픈AI가\n새 모델을 발표했다.";
  const { user } = buildTuningPrompt(bodyKo);
  assert.match(user, /오픈AI가\n새 모델을 발표했다\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/expert-picks-tuning.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the prompt builder and OpenAI call wrapper**

```typescript
// src/lib/expert-picks-tuning.ts
import OpenAI from "openai";

export function buildTuningPrompt(bodyKo: string): { system: string; user: string } {
  const system = [
    "너는 한국어 편집자다. 아래 원문의 사실관계(fact)와 의미는 절대 바꾸지 마라.",
    "맞춤법, 띄어쓰기, 문장부호만 정리하고 카카오톡 특유의 줄임말·이모지 남발만 다듬어라.",
    "문단 구성(줄바꿈)은 원문 그대로 유지하라. 새로운 문장을 추가하거나 내용을 요약하지 마라.",
    "결과는 다듬어진 본문 텍스트만 출력하라. 설명이나 따옴표를 덧붙이지 마라.",
  ].join(" ");
  const user = bodyKo;
  return { system, user };
}

export async function tuneExpertPickBody(
  bodyKo: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const { system, user } = buildTuningPrompt(bodyKo);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  const tuned = completion.choices[0]?.message?.content?.trim();
  if (!tuned) throw new Error("AI tuning returned an empty result");
  return tuned;
}

export async function translateExpertPickBody(
  bodyKo: string,
): Promise<{ titleEn: string; bodyEn: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Translate the given Korean text to natural English, preserving paragraph breaks exactly. " +
          "Output strict JSON: {\"title\": \"...\", \"body\": \"...\"} with no other text.",
      },
      { role: "user", content: bodyKo },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("Translation returned an empty result");
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  return { titleEn: parsed.title ?? "", bodyEn: parsed.body ?? "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/expert-picks-tuning.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing route contract test**

```typescript
// src/app/api/admin/expert-picks/tune/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("tune route requires admin auth and never writes to the DB directly", () => {
  assert.match(routeSource, /requireAdminRequest\(req\)/);
  assert.doesNotMatch(routeSource, /updateExpertPick|insertExpertPick/);
});

test("tune route falls back gracefully when OPENAI_API_KEY is missing", () => {
  assert.match(routeSource, /status:\s*503/);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/tune/route.test.ts"`
Expected: FAIL — file doesn't exist.

- [ ] **Step 7: Implement the route**

```typescript
// src/app/api/admin/expert-picks/tune/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { tuneExpertPickBody, translateExpertPickBody } from "@/lib/expert-picks-tuning";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI tuning is not configured on server" },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => null);
    const bodyKo = typeof body?.bodyKo === "string" ? body.bodyKo.trim() : "";
    if (!bodyKo) {
      return NextResponse.json({ error: "bodyKo is required" }, { status: 400 });
    }

    const tunedKo = await tuneExpertPickBody(bodyKo);

    if (body?.includeEnglish) {
      const { titleEn, bodyEn } = await translateExpertPickBody(tunedKo);
      return NextResponse.json({ ok: true, tunedKo, tunedTitleEn: titleEn, tunedBodyEn: bodyEn });
    }

    return NextResponse.json({ ok: true, tunedKo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/admin/expert-picks/tune][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --import tsx --test "src/app/api/admin/expert-picks/tune/route.test.ts"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/expert-picks-tuning.ts src/lib/expert-picks-tuning.test.ts "src/app/api/admin/expert-picks/tune/route.ts" "src/app/api/admin/expert-picks/tune/route.test.ts"
git commit -m "feat(admin-api): add AI tuning endpoint for expert picks (preview-only, no auto-apply)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Public API — list, detail, and batch view tracking

**Files:**
- Create: `src/lib/expert-pick-view-tracking.ts`
- Create: `src/app/api/v1/expert-picks/route.ts`
- Create: `src/app/api/v1/expert-picks/[id]/route.ts`
- Create: `src/app/api/v1/expert-picks/views/route.ts`
- Test: `src/app/api/v1/expert-picks/route.test.ts`
- Test: `src/lib/expert-pick-view-tracking.test.ts`

**Interfaces:**
- Consumes: `listExpertPicks`, `getExpertPickById`, `getExpertPickMaxUpdatedAt`, `claimExpertPickViewEvent`, `incrementExpertPickViewCountBatch` from `@/lib/db/queries`.
- Produces:
  - `normalizeExpertPickIds(ids: unknown[]): number[]`
  - `trackExpertPickViews(request: Request, ids: number[]): Promise<{ counted: number; valid: number[]; trackingEnabled: boolean }>`
  - `GET /api/v1/expert-picks?lang=ko|en` → `{ items: [...], updatedAt }`
  - `GET /api/v1/expert-picks/:id?lang=ko|en` → single item or 404
  - `POST /api/v1/expert-picks/views { ids: number[] }` → `{ ok, counted, ignored, trackingEnabled }`

- [ ] **Step 1: Write the failing view-tracking unit test**

```typescript
// src/lib/expert-pick-view-tracking.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExpertPickIds } from "./expert-pick-view-tracking";

test("normalizeExpertPickIds keeps only positive integers, dedupes, caps at 20", () => {
  const input = [1, 1, 2, "3", -1, 0, 4.5, "not a number", ...Array.from({ length: 30 }, (_, i) => i + 100)];
  const result = normalizeExpertPickIds(input);
  assert.deepEqual(result.slice(0, 3), [1, 2, 100]);
  assert.ok(result.length <= 20);
  assert.ok(result.every((id) => Number.isInteger(id) && id > 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/expert-pick-view-tracking.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement view tracking**

```typescript
// src/lib/expert-pick-view-tracking.ts
import { createHmac } from "node:crypto";
import {
  claimExpertPickViewEvent,
  getExpertPickById,
  incrementExpertPickViewCountBatch,
} from "@/lib/db/queries";

const VIEW_BUCKET_MS = 60 * 60 * 1000;
const MAX_IDS = 20;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function getViewerHash(request: Request): string | null {
  const secret = process.env.VIEW_EVENT_HMAC_SECRET?.trim();
  if (!secret) return null;
  const fingerprint = `${getClientIp(request)}\n${request.headers.get("user-agent") ?? ""}`;
  return createHmac("sha256", secret).update(fingerprint).digest("hex");
}

function currentBucket(): Date {
  return new Date(Math.floor(Date.now() / VIEW_BUCKET_MS) * VIEW_BUCKET_MS);
}

export function normalizeExpertPickIds(ids: unknown[]): number[] {
  return [
    ...new Set(
      ids
        .map((id) => (typeof id === "string" ? Number.parseInt(id, 10) : id))
        .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0),
    ),
  ].slice(0, MAX_IDS);
}

export async function trackExpertPickViews(
  request: Request,
  ids: number[],
): Promise<{ counted: number; valid: number[]; trackingEnabled: boolean }> {
  const viewerHash = getViewerHash(request);
  const valid = (
    await Promise.all(ids.map(async (id) => ((await getExpertPickById(id)) ? id : null)))
  ).filter((id): id is number => id !== null);

  if (!viewerHash || valid.length === 0) {
    return { counted: 0, valid, trackingEnabled: Boolean(viewerHash) };
  }

  const bucket = currentBucket();
  const claimed = (
    await Promise.all(
      valid.map(async (id) => ((await claimExpertPickViewEvent(id, viewerHash, bucket)) ? id : null)),
    )
  ).filter((id): id is number => id !== null);

  if (claimed.length > 0) await incrementExpertPickViewCountBatch(claimed);
  return { counted: claimed.length, valid, trackingEnabled: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/expert-pick-view-tracking.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing public-list contract test**

```typescript
// src/app/api/v1/expert-picks/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("public list endpoint only returns enabled items and supports If-Modified-Since caching", () => {
  assert.match(routeSource, /listExpertPicks\(true\)/);
  assert.match(routeSource, /if-modified-since/);
  assert.match(routeSource, /304/);
});

test("public list endpoint never exposes body_ko_raw or ai_tuned internals", () => {
  assert.doesNotMatch(routeSource, /body_ko_raw|aiTuned|ai_tuned/);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --import tsx --test "src/app/api/v1/expert-picks/route.test.ts"`
Expected: FAIL — file doesn't exist.

- [ ] **Step 7: Implement the public routes**

```typescript
// src/app/api/v1/expert-picks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listExpertPicks, getExpertPickMaxUpdatedAt } from "@/lib/db/queries";

export const runtime = "edge";
export const revalidate = 3600;

export async function GET(req: NextRequest) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";

    const ifModifiedSince = req.headers.get("if-modified-since");
    const maxUpdatedAt = await getExpertPickMaxUpdatedAt();

    if (ifModifiedSince && maxUpdatedAt) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const serverDate = new Date(maxUpdatedAt).getTime();
      if (!isNaN(clientDate) && serverDate <= clientDate) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const rows = await listExpertPicks(true);
    const items = rows.map((r) => ({
      id: r.id,
      title: lang === "en" ? r.title_en || r.title_ko : r.title_ko,
      body: lang === "en" ? r.body_en || r.body_ko : r.body_ko,
      imageUrl: r.image_url,
      linkUrl: r.link_url,
      linkDomain: r.link_domain,
      authorLabel: r.author_label,
      viewCount: r.view_count,
      createdAt: r.created_at,
    }));

    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    };
    if (maxUpdatedAt) headers["Last-Modified"] = new Date(maxUpdatedAt).toUTCString();

    return NextResponse.json({ items, updatedAt: maxUpdatedAt }, { headers });
  } catch (err) {
    console.error("[/api/v1/expert-picks][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/expert-picks/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getExpertPickById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ko";
    const { id: idParam } = await params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const item = await getExpertPickById(id);
    if (!item || !item.enabled) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: item.id,
      title: lang === "en" ? item.title_en || item.title_ko : item.title_ko,
      body: lang === "en" ? item.body_en || item.body_ko : item.body_ko,
      imageUrl: item.image_url,
      linkUrl: item.link_url,
      linkDomain: item.link_domain,
      authorLabel: item.author_label,
      viewCount: item.view_count,
      createdAt: item.created_at,
    });
  } catch (err) {
    console.error("[/api/v1/expert-picks/[id]][GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/expert-picks/views/route.ts
import { NextRequest, NextResponse } from "next/server";
import { normalizeExpertPickIds, trackExpertPickViews } from "@/lib/expert-pick-view-tracking";

export const runtime = "nodejs";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }

    const validIds = normalizeExpertPickIds(ids);
    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }

    const result = await trackExpertPickViews(req, validIds);
    return NextResponse.json({
      ok: true,
      counted: result.counted,
      ignored: validIds.length - result.valid.length,
      trackingEnabled: result.trackingEnabled,
    });
  } catch (err) {
    console.error("[/api/v1/expert-picks/views]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --import tsx --test "src/app/api/v1/expert-picks/route.test.ts"`
Expected: PASS

- [ ] **Step 9: Run full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/expert-pick-view-tracking.ts src/lib/expert-pick-view-tracking.test.ts "src/app/api/v1/expert-picks"
git commit -m "feat(public-api): add expert-picks list/detail/view-tracking endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Rate limiting wiring

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/middleware.test.ts` (new)

**Interfaces:**
- Modifies the `RATE_LIMITS` array — no new exports.

- [ ] **Step 1: Write the failing test**

```typescript
// src/middleware.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const middlewareSource = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");

test("expert-picks views endpoint has its own tighter rate limit than the general list endpoint", () => {
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks\/views",\s*\d+\]/);
  assert.match(middlewareSource, /\["\/api\/v1\/expert-picks",\s*\d+\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/middleware.test.ts`
Expected: FAIL — patterns not present yet.

- [ ] **Step 3: Add the rate-limit entries**

In `src/middleware.ts`, insert into `RATE_LIMITS` (order matters — more specific prefixes must come before less specific ones, so add these directly above the `["/api/v1/keywords", 60]` line):

```typescript
  ["/api/v1/expert-picks/views", 15], // 조회수 집계 — keywords/views와 동일한 보호 수준
  ["/api/v1/expert-picks", 60],       // 전문가픽 목록/상세
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat: rate-limit expert-picks public endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Web admin UI panel

**Files:**
- Create: `src/app/admin/expert-picks-panel.tsx`
- Modify: `src/app/admin/admin-nav.tsx`
- Modify: `src/app/admin/page.tsx`
- Test: `src/app/admin/page_contract.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `parseExpertPickPaste` from `@/lib/expert-picks-parser` (client-side preview only — server re-parses authoritatively).
- Produces: `ExpertPicksPanel` React component, wired into `AdminNav`/`AdminPage` as tab `"expertPicks"`.

- [ ] **Step 1: Write the failing wiring test (extend existing contract test file)**

Append to `src/app/admin/page_contract.test.ts`:

```typescript
test("admin page renders the expert-picks panel on its tab", () => {
  assert.match(pageSource, /import \{ ExpertPicksPanel \}/);
  assert.match(pageSource, /<ExpertPicksPanel \/>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/app/admin/page_contract.test.ts`
Expected: FAIL — `ExpertPicksPanel` not imported/rendered yet.

- [ ] **Step 3: Add the tab to `AdminNav`**

In `src/app/admin/admin-nav.tsx`, update the type and TABS array:

```typescript
export type AdminTab = "keywords" | "ranking" | "youtube" | "promo" | "expertPicks";
```

```typescript
const TABS: Array<{ id: AdminTab; label: string; href?: string }> = [
  { id: "keywords", label: "수동 키워드 설정" },
  { id: "ranking", label: "랭킹 시뮬레이터", href: "/admin/ranking-simulator" },
  { id: "youtube", label: "유튜브 수집 채널" },
  { id: "promo", label: "프로모션 관리" },
  { id: "expertPicks", label: "전문가픽 관리" },
];
```

- [ ] **Step 4: Implement the panel component**

```typescript
// src/app/admin/expert-picks-panel.tsx
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
  const [tunedPreview, setTunedPreview] = useState<string | null>(null);

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
    if (!pasteText.trim()) return;
    setTuning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/expert-picks/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyKo: pasteText.trim() }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = await res.json();
      setTunedPreview(data.tunedKo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 튜닝 실패");
    } finally {
      setTuning(false);
    }
  };

  const applyTuned = () => {
    if (tunedPreview) {
      setPasteText(tunedPreview);
      setTunedPreview(null);
    }
  };

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
          bodyKoRaw: pasteText,
          imageUrl,
          authorLabel: authorLabel.trim(),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setPasteText("");
      setImageUrl("");
      setAuthorLabel("");
      setTunedPreview(null);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (item: ExpertPickItem) => {
    await fetch(`/api/admin/expert-picks/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !item.enabled, expectedUpdatedAt: item.updated_at }),
    });
    await fetchItems();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/admin/expert-picks/${id}`, { method: "DELETE" });
    await fetchItems();
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
            {tuning ? "AI가 다듬는 중..." : "✨ AI로 다듬기"}
          </button>
        </div>

        {tunedPreview && (
          <div className="rounded-lg border border-violet-500/40 bg-zinc-950 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">원문</p>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{pasteText}</p>
            </div>
            <div>
              <p className="text-xs text-violet-300 mb-1">AI 튜닝 결과</p>
              <p className="text-sm text-zinc-100 whitespace-pre-wrap">{tunedPreview}</p>
              <button
                type="button"
                onClick={applyTuned}
                className="mt-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 text-xs font-bold"
              >
                이 버전 적용
              </button>
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
```

- [ ] **Step 5: Wire the panel into `page.tsx`**

In `src/app/admin/page.tsx`, add the import:

```typescript
import { ExpertPicksPanel } from "./expert-picks-panel";
```

And add the render block right after the `{/* ── 프로모션 관리 ── */}` block:

```typescript
        {/* ── 전문가픽 관리 ── */}
        {activeTab === "expertPicks" && <ExpertPicksPanel />}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test src/app/admin/page_contract.test.ts`
Expected: PASS

- [ ] **Step 7: Run lint and full test suite**

Run: `npm run lint && npm test`
Expected: no lint errors, all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/expert-picks-panel.tsx src/app/admin/admin-nav.tsx src/app/admin/page.tsx src/app/admin/page_contract.test.ts
git commit -m "feat(admin-ui): add expert-picks paste-to-publish panel with AI tuning preview

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npm test` — all tests pass.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run build` — production build succeeds (confirms Vercel Blob import resolves and no type errors across the new route handlers).
- [ ] Manually verify against a local `.env.local` with `BLOB_READ_WRITE_TOKEN` and `OPENAI_API_KEY` set: paste a multi-paragraph Korean text with a URL into the admin panel, confirm title/link auto-detected, upload an image, click "AI로 다듬기", apply the tuned version, publish, then confirm `GET /api/v1/expert-picks` returns it with newlines intact.
