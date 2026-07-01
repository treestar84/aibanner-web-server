# Canonical Keyword Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `keywordId` stable across days for the same real-world entity, so the existing evergreen/repeat-exposure penalty (`repeat_exposure_policy.ts`) actually fires for recurring generic terms (e.g. "MCP server", "AI 코딩 에이전트", "바이브 코딩", "Gemini CLI") instead of resetting every time the LLM extracts a slightly different surface form.

**Architecture:** Today, `keywordId = slugify(kw.keyword)` is derived purely from that day's extracted text (`src/lib/pipeline/keywords.ts:1442`). Korean spacing/hyphenation variance (`"바이브코딩"` vs `"바이브 코딩"`) or capitalization drift produces a different hash each day, so `appearances` counting in `snapshot.ts:932-949` (which joins strictly on `keywordId` across the last 16 snapshots) almost never accumulates enough history for genuinely-repeating generic keywords to trigger the penalty in `repeat_exposure_policy.ts`. The `keyword_aliases` table already persists `alias → canonical_keyword_id` mappings (written post-ranking, used today only for search) — we reuse it as a **pre-ranking identity lookup**: before today's keywords enter scoring/ranking, look up whether any of their alias forms already point to an existing canonical ID from a prior day, and if so, adopt that ID instead of minting a new slug. This closes the loop with zero new hardcoded word lists — any keyword (English or Korean, known or brand-new like "Gemini CLI") that keeps reappearing will now be recognized as the same entity and become eligible for the existing evergreen penalty.

**Tech Stack:** TypeScript, Next.js API routes, Neon Postgres (`@/lib/db/client`), `node:test` + `node:assert/strict` for unit tests (run via `npm test`, which runs `node --import tsx --test $(find src -type f -name '*.test.ts')`).

## Global Constraints

- No new DB tables/columns — reuse existing `keyword_aliases(canonical_keyword_id, alias, lang)` table and its `idx_aliases_alias` index (`src/lib/db/schema.sql:52-61`).
- No changes to `repeat_exposure_policy.ts`, `audience_relevance.ts`, `ranking_policy.ts`, or any hardcoded exclusion list — this plan only fixes identity stability upstream of those, per user decision to pursue the durable fix over further list patches.
- Zero behavior change for genuinely-new keywords (no prior alias match): they keep their slug-derived `keywordId` exactly as today.
- If an alias key ambiguously matches two different canonical IDs already in the DB (should not normally happen given the table's PK), resolution must be deterministic (most-recently-created wins) — no crash, no silent duplicate assignment.
- If two keywords extracted in the *same* run would resolve to the *same* canonical ID, only the first (by array order) may claim it; the second keeps its own slug ID rather than colliding — never merge two same-day candidates as a side effect of this change.
- All new pure logic must be unit-testable without a live database.

---

## File Structure

- **Create:** `src/lib/pipeline/keyword_identity.ts` — pure functions for alias-key normalization and canonical ID resolution. No DB import.
- **Create:** `src/lib/pipeline/keyword_identity.test.ts` — unit tests for the above.
- **Modify:** `src/lib/db/queries.ts` — add `getCanonicalKeywordIdsByAliases()`; change `upsertKeywordAliases()` to persist both the spaced and compact alias forms (via `buildAliasLookupKeys`) instead of only the spaced form; remove the now-duplicate private `normalizeAlias()` in favor of the shared helper.
- **Modify:** `src/lib/pipeline/snapshot.ts` — insert the canonical-ID resolution step right after keyword extraction (`normalizeKeywords` call, currently line 871), before ranking/scoring/history begin.

---

### Task 1: Pure canonical-identity resolution module

**Files:**
- Create: `src/lib/pipeline/keyword_identity.ts`
- Test: `src/lib/pipeline/keyword_identity.test.ts`

**Interfaces:**
- Consumes: `NormalizedKeyword` type from `src/lib/pipeline/keywords.ts` (`{ keywordId: string; keyword: string; aliases: string[]; candidates: KeywordCandidate }`, already defined at `keywords.ts:203-208`).
- Produces (used by Task 2 and Task 3):
  - `normalizeAliasKey(text: string): string`
  - `compactAliasKey(text: string): string`
  - `buildAliasLookupKeys(text: string): string[]`
  - `collectAliasLookupKeys(keywords: readonly NormalizedKeyword[]): string[]`
  - `resolveCanonicalKeywordIds(keywords: readonly NormalizedKeyword[], aliasCanonicalMap: ReadonlyMap<string, string>): { resolved: NormalizedKeyword[]; remappedCount: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pipeline/keyword_identity.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAliasKey,
  compactAliasKey,
  buildAliasLookupKeys,
  collectAliasLookupKeys,
  resolveCanonicalKeywordIds,
} from "@/lib/pipeline/keyword_identity";
import type { NormalizedKeyword } from "@/lib/pipeline/keywords";

function makeKeyword(overrides: Partial<NormalizedKeyword>): NormalizedKeyword {
  return {
    keywordId: "kw_default",
    keyword: "Default Keyword",
    aliases: [],
    candidates: {
      text: "Default Keyword",
      count: 1,
      domains: new Set(["example.com"]),
      matchedItems: new Set([0]),
      latestAt: new Date("2026-07-01T00:00:00Z"),
      tier: "P1_CONTEXT",
      domainBonus: 0,
      authorityOverride: 0,
    },
    ...overrides,
  };
}

test("normalizeAliasKey lowercases, NFKC-normalizes, and collapses whitespace", () => {
  assert.equal(normalizeAliasKey("  Gemini   CLI  "), "gemini cli");
  assert.equal(normalizeAliasKey("MCP-Server"), "mcp-server");
});

test("compactAliasKey strips all whitespace after normalizing", () => {
  assert.equal(compactAliasKey("바이브 코딩"), "바이브코딩");
  assert.equal(compactAliasKey("바이브코딩"), "바이브코딩");
});

test("buildAliasLookupKeys returns both spaced and compact forms without duplicates", () => {
  assert.deepEqual(buildAliasLookupKeys("바이브 코딩"), ["바이브 코딩", "바이브코딩"]);
  assert.deepEqual(buildAliasLookupKeys("바이브코딩"), ["바이브코딩"]);
});

test("buildAliasLookupKeys drops keys shorter than 2 chars", () => {
  assert.deepEqual(buildAliasLookupKeys("a"), []);
});

test("collectAliasLookupKeys gathers keys from keyword text and its aliases", () => {
  const keywords = [
    makeKeyword({ keyword: "Gemini CLI", aliases: ["제미나이 CLI"] }),
    makeKeyword({ keywordId: "kw_2", keyword: "바이브 코딩", aliases: [] }),
  ];
  const keys = collectAliasLookupKeys(keywords);
  assert.equal(keys.includes("gemini cli"), true);
  assert.equal(keys.includes("제미나이 cli"), true);
  assert.equal(keys.includes("바이브 코딩"), true);
  assert.equal(keys.includes("바이브코딩"), true);
});

test("resolveCanonicalKeywordIds remaps a keyword whose alias matches an existing canonical ID", () => {
  const keywords = [makeKeyword({ keywordId: "kw_today_hash", keyword: "바이브코딩" })];
  const aliasMap = new Map([["바이브코딩", "kw_20260615_vibecoding"]]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 1);
  assert.equal(resolved[0].keywordId, "kw_20260615_vibecoding");
  assert.equal(resolved[0].keyword, "바이브코딩");
});

test("resolveCanonicalKeywordIds leaves a brand-new keyword's slug ID untouched", () => {
  const keywords = [makeKeyword({ keywordId: "kw_brand_new", keyword: "Some New Tool" })];

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, new Map());

  assert.equal(remappedCount, 0);
  assert.equal(resolved[0].keywordId, "kw_brand_new");
});

test("resolveCanonicalKeywordIds does not remap when the match already equals the current ID", () => {
  const keywords = [makeKeyword({ keywordId: "kw_same", keyword: "Gemini CLI" })];
  const aliasMap = new Map([["gemini cli", "kw_same"]]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 0);
  assert.equal(resolved[0].keywordId, "kw_same");
});

test("resolveCanonicalKeywordIds never assigns the same canonical ID to two different same-day keywords", () => {
  const keywords = [
    makeKeyword({ keywordId: "kw_a", keyword: "MCP Server" }),
    makeKeyword({ keywordId: "kw_b", keyword: "MCP서버" }),
  ];
  // Both alias forms happen to point at the same historical canonical ID.
  const aliasMap = new Map([
    ["mcp server", "kw_history_mcp"],
    ["mcp서버", "kw_history_mcp"],
  ]);

  const { resolved, remappedCount } = resolveCanonicalKeywordIds(keywords, aliasMap);

  assert.equal(remappedCount, 1);
  const ids = resolved.map((k) => k.keywordId);
  assert.equal(ids.includes("kw_history_mcp"), true);
  assert.equal(new Set(ids).size, 2, "each resolved keyword must keep a distinct id");
});

test("resolveCanonicalKeywordIds preserves all other NormalizedKeyword fields", () => {
  const original = makeKeyword({ keywordId: "kw_x", keyword: "Gemini CLI", aliases: ["제미나이 CLI"] });
  const aliasMap = new Map([["gemini cli", "kw_history_gemini_cli"]]);

  const { resolved } = resolveCanonicalKeywordIds([original], aliasMap);

  assert.equal(resolved[0].keyword, original.keyword);
  assert.deepEqual(resolved[0].aliases, original.aliases);
  assert.equal(resolved[0].candidates, original.candidates);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/lib/pipeline/keyword_identity.test.ts`
Expected: FAIL with `Cannot find module '@/lib/pipeline/keyword_identity'` (or similar module-not-found error), since the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pipeline/keyword_identity.ts`:

```typescript
import type { NormalizedKeyword } from "./keywords";

/**
 * Same normalization used both when persisting aliases (queries.ts::upsertKeywordAliases)
 * and when looking them up here — if these two ever drift apart, cross-day identity
 * matching silently breaks again, which is the exact bug this module fixes.
 */
export function normalizeAliasKey(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function compactAliasKey(text: string): string {
  return normalizeAliasKey(text).replace(/\s+/g, "");
}

export function buildAliasLookupKeys(text: string): string[] {
  const spaced = normalizeAliasKey(text);
  const compact = compactAliasKey(text);
  return [...new Set([spaced, compact])].filter((key) => key.length >= 2);
}

export function collectAliasLookupKeys(keywords: readonly NormalizedKeyword[]): string[] {
  const keys = new Set<string>();
  for (const keyword of keywords) {
    for (const key of buildAliasLookupKeys(keyword.keyword)) keys.add(key);
    for (const alias of keyword.aliases) {
      for (const key of buildAliasLookupKeys(alias)) keys.add(key);
    }
  }
  return [...keys];
}

export interface CanonicalResolutionResult {
  readonly resolved: NormalizedKeyword[];
  readonly remappedCount: number;
}

/**
 * Reassigns keywordId to a prior day's canonical ID when today's keyword text/aliases
 * match an existing keyword_aliases entry, so appearance-count-based evergreen
 * detection (repeat_exposure_policy.ts) accumulates history correctly across surface
 * text drift instead of resetting every run.
 */
export function resolveCanonicalKeywordIds(
  keywords: readonly NormalizedKeyword[],
  aliasCanonicalMap: ReadonlyMap<string, string>
): CanonicalResolutionResult {
  const usedCanonicalIds = new Set<string>();
  let remappedCount = 0;

  const resolved = keywords.map((keyword) => {
    const lookupKeys = [
      ...buildAliasLookupKeys(keyword.keyword),
      ...keyword.aliases.flatMap((alias) => buildAliasLookupKeys(alias)),
    ];

    let canonicalId: string | undefined;
    for (const key of lookupKeys) {
      const candidate = aliasCanonicalMap.get(key);
      if (candidate && !usedCanonicalIds.has(candidate)) {
        canonicalId = candidate;
        break;
      }
    }

    if (!canonicalId || canonicalId === keyword.keywordId) {
      usedCanonicalIds.add(keyword.keywordId);
      return keyword;
    }

    usedCanonicalIds.add(canonicalId);
    remappedCount += 1;
    return { ...keyword, keywordId: canonicalId };
  });

  return { resolved, remappedCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/lib/pipeline/keyword_identity.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/keyword_identity.ts src/lib/pipeline/keyword_identity.test.ts
git commit -m "feat(pipeline): add pure canonical keyword-identity resolution"
```

---

### Task 2: Persist compact alias form and expose alias-based canonical lookup

**Files:**
- Modify: `src/lib/db/queries.ts:1113-1149` (the `normalizeAlias`, `detectAliasLang`, `upsertKeywordAliases` block)

**Interfaces:**
- Consumes: `buildAliasLookupKeys` from Task 1 (`src/lib/pipeline/keyword_identity.ts`).
- Produces (used by Task 3): `getCanonicalKeywordIdsByAliases(aliasKeys: string[]): Promise<Map<string, string>>`, exported from `src/lib/db/queries.ts`.

This task touches DB-calling code with no existing unit test harness for `queries.ts` (no mock DB in this repo — `src/lib/db/manual-youtube-query-contract.test.ts` is the only test file in that directory and it tests a pure contract function, not a live query). Do not add a live-DB test; keep the diff mechanically simple and lean on Task 1's tests plus the manual verification in Task 4.

- [ ] **Step 1: Replace the private `normalizeAlias` with the shared helper and persist both alias forms**

In `src/lib/db/queries.ts`, first add the import near the top (after the existing `@/lib/pipeline/mode` import, so all pipeline imports stay grouped):

```typescript
import type { PipelineMode } from "@/lib/pipeline/mode";
import { buildAliasLookupKeys } from "@/lib/pipeline/keyword_identity";
```

Then replace lines 1113-1149 (the block starting at `function normalizeAlias` through the end of `upsertKeywordAliases`) with:

```typescript
function detectAliasLang(alias: string): "ko" | "en" {
  if (/[가-힯㄰-㆏ᄀ-ᇿ]/.test(alias)) return "ko";
  return "en";
}

export async function upsertKeywordAliases(
  canonicalKeywordId: string,
  aliases: string[],
): Promise<void> {
  const normalizedCanonicalId = canonicalKeywordId.trim();
  if (!normalizedCanonicalId) return;

  const dedupedAliases = [
    ...new Set(aliases.flatMap((alias) => buildAliasLookupKeys(alias))),
  ].slice(0, 60);
  if (dedupedAliases.length === 0) return;

  await Promise.all(
    dedupedAliases.map(
      (alias) =>
        sql`
        INSERT INTO keyword_aliases (
          canonical_keyword_id,
          alias,
          lang
        )
        VALUES (
          ${normalizedCanonicalId},
          ${alias},
          ${detectAliasLang(alias)}
        )
        ON CONFLICT (canonical_keyword_id, alias) DO NOTHING
      `,
    ),
  );
}

/**
 * Looks up existing canonical_keyword_id for any of today's alias-lookup keys.
 * Used pre-ranking (snapshot.ts) so recurring keywords keep the same keywordId
 * across days even when the LLM's surface-text extraction varies slightly.
 * When an alias key was historically attached to more than one canonical id,
 * the most recently created mapping wins (deterministic, no crash).
 */
export async function getCanonicalKeywordIdsByAliases(
  aliasKeys: string[],
): Promise<Map<string, string>> {
  if (aliasKeys.length === 0) return new Map();

  const rows = (await sql`
    SELECT DISTINCT ON (alias) alias, canonical_keyword_id
    FROM keyword_aliases
    WHERE alias = ANY(${aliasKeys})
    ORDER BY alias, created_at DESC
  `) as { alias: string; canonical_keyword_id: string }[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.alias, row.canonical_keyword_id);
  }
  return map;
}
```

Note: the alias cap increased from 30 to 60 (was `slice(0, 30)`) because `buildAliasLookupKeys` can now emit two keys (spaced + compact) per input alias where the original only emitted one; doubling keeps the same effective per-input-alias coverage.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No new errors. (If the project's tsconfig doesn't include a bare `--noEmit -p` invocation, use whatever type-check script exists in `package.json` — check with `grep -n '"typecheck"\|"build"' package.json` first and use that script instead.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/queries.ts
git commit -m "feat(db): persist compact alias form and add canonical-id-by-alias lookup"
```

---

### Task 3: Wire canonical resolution into the snapshot pipeline

**Files:**
- Modify: `src/lib/pipeline/snapshot.ts:1-65` (imports) and `:871-872` (insertion point)

**Interfaces:**
- Consumes: `collectAliasLookupKeys`, `resolveCanonicalKeywordIds` (Task 1); `getCanonicalKeywordIdsByAliases` (Task 2).
- Produces: `normalizedKeywords` (existing downstream name, unchanged type `NormalizedKeyword[]`) now carries canonicalized `keywordId`s before it reaches `rankKeywords`, `buildKeywordPolicyMap`, and the `appearances` history loop at `snapshot.ts:932-949`.

- [ ] **Step 1: Add imports**

In `src/lib/pipeline/snapshot.ts`, after line 18 (`import { normalizeKeywords } from "./keywords";`), add:

```typescript
import { collectAliasLookupKeys, resolveCanonicalKeywordIds } from "./keyword_identity";
```

Then find the `@/lib/db/queries` import block (lines 50-65, a multi-line named import). Add `getCanonicalKeywordIdsByAliases` to that named import list, keeping the existing entries alphabetically-ish grouped as they already are — just add it as one more line inside the braces.

- [ ] **Step 2: Insert the resolution step**

Replace:

```typescript
  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const normalizedKeywords = await normalizeKeywords(allItems, { mode });
  console.log(`[snapshot] Got ${normalizedKeywords.length} normalized keywords`);
```

with:

```typescript
  // 2~3) 키워드 추출 + 정규화 (AI 클러스터링)
  console.log("[snapshot] Step 2-3: Normalizing keywords...");
  const extractedKeywords = await normalizeKeywords(allItems, { mode });
  console.log(`[snapshot] Got ${extractedKeywords.length} normalized keywords`);

  // 2-4) canonical ID 재해석: 과거 스냅샷의 keyword_aliases와 매칭되면 그 canonical ID를
  // 재사용해, appearances 기반 evergreen 패널티(repeat_exposure_policy.ts)가 표면 텍스트
  // 변형(띄어쓰기/표기 차이)에 의해 리셋되지 않도록 한다.
  const aliasLookupKeys = collectAliasLookupKeys(extractedKeywords);
  const aliasCanonicalMap = await getCanonicalKeywordIdsByAliases(aliasLookupKeys);
  const { resolved: normalizedKeywords, remappedCount } = resolveCanonicalKeywordIds(
    extractedKeywords,
    aliasCanonicalMap
  );
  console.log(
    `[snapshot] Canonical ID resolution: ${remappedCount}/${extractedKeywords.length} keywords remapped to existing canonical IDs`
  );
```

Everything below this point in `snapshot.ts` (`normalizedKeywords.length` at the old line 883, `rankKeywords(normalizedKeywords, ...)` at the old line 891, `buildKeywordPolicyMap(normalizedKeywords, allItems)` at the old line 896, and the `appearances` loop at lines 932-949) already reads the `normalizedKeywords` binding and requires no further changes — it now transparently receives canonicalized IDs.

- [ ] **Step 3: Type-check**

Run the project's type-check script (see Task 2 Step 2 for how to find it) and confirm no new errors, in particular that `getCanonicalKeywordIdsByAliases` is now recognized as imported from `@/lib/db/queries`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/snapshot.ts
git commit -m "feat(pipeline): resolve canonical keyword IDs before ranking"
```

---

### Task 4: Full test suite run and manual verification plan

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All existing tests plus the 9 new tests in `keyword_identity.test.ts` PASS. Pay particular attention to `src/lib/pipeline/ranking_policy.test.ts`, `repeat_exposure_policy.test.ts`, and `snapshot_quality_integration.test.ts` — none of them should need changes, since this plan does not touch their inputs' shape, only where `keywordId` values originate.

- [ ] **Step 2: Confirm no other code assumes `keywordId` is derived purely from that day's `keyword` text**

Run: `grep -rn "slugify(" src/lib/pipeline/`
Expected: The only call site remains `keywords.ts:1442` (`keywordId: slugify(kw.keyword)`), which is intentionally left as the *fallback* for genuinely new keywords — Task 3's resolution step runs after this and only overrides the ID when a historical alias match exists. If other call sites exist, read them to confirm they don't independently assume same-day-only identity; report to the user before proceeding if any do.

- [ ] **Step 3: Manual dry-run against a real snapshot (requires `DATABASE_URL`, `OPENAI_API_KEY`, and other pipeline env vars configured locally)**

This cannot be scripted into an assertion — it requires live external services. Document the check for the user to run themselves (or run it yourself if credentials are available in this environment):

1. Trigger one snapshot run (however the project normally triggers it locally — check `package.json` for a script like `"snapshot"` or hit `GET /api/cron/snapshot` locally with `CRON_SECRET`).
2. Look for the new log line: `[snapshot] Canonical ID resolution: N/M keywords remapped to existing canonical IDs`.
3. On the *first* run after deploying this change, `N` will likely be low (the alias table wasn't populated with compact-form keys before this change). This is expected — Task 2's `upsertKeywordAliases` change means every keyword ranked from this point forward starts building up compact-form aliases, so `N` should grow over the following 1-2 days as the same generic terms reappear and start resolving to stable canonical IDs.
4. After 2-3 days of snapshots, spot-check a known recurring generic term (e.g. query the `keywords` table for a keyword with text similar to `"MCP"` or `"바이브"` across recent snapshots) and confirm its `keyword_id` is now identical across those days. This is the direct evidence that `appearances` counting (and therefore `repeat_exposure_policy.ts`'s evergreen penalty) is now working for that term.

- [ ] **Step 4: Report back**

Summarize to the user: tests passing, remap count observed (if a dry run was possible), and the 2-3 day follow-up check described in Step 3.4 as the real-world confirmation signal — since this fix's effect is inherently observable only across multiple days of snapshots, not in a single run.

---

## Self-Review Notes

- **Spec coverage:** User approved "영속적 canonical ID 도입" (persistent canonical ID). Task 1 builds the pure resolution logic, Task 2 makes the alias table symmetric (same normalization on write and read — the exact class of bug being fixed), Task 3 wires it into the pipeline before ranking (so `appearances`, `audience_relevance`, and `repeat_exposure_policy` all benefit without modification), Task 4 verifies. No hardcoded word list was added anywhere in this plan, per the root-cause finding that reactive lists are the problem being solved, not the solution.
- **Placeholder scan:** No TBD/TODO; every step has runnable code or an exact command.
- **Type consistency:** `resolveCanonicalKeywordIds` returns `{ resolved, remappedCount }` in Task 1 and is destructured identically (`const { resolved: normalizedKeywords, remappedCount } = ...`) in Task 3. `getCanonicalKeywordIdsByAliases` returns `Map<string, string>` in Task 2 and is consumed as `ReadonlyMap<string, string>` by `resolveCanonicalKeywordIds` in Task 1 — `Map` satisfies `ReadonlyMap` structurally, no cast needed.
