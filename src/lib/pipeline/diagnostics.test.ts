import assert from "node:assert/strict";
import test from "node:test";
import { withPipelineDiagnostics, withKeywordDiagnostics, recordDiagnostic,
  observeSources, setDiagnosticSnapshot, diagnosticFailure } from "./diagnostics";

const parse = (lines: string[]) => lines.map((line) => JSON.parse(line.slice("[pipeline_diag] ".length)));

test("diagnostics default off emits nothing and preserves returned object", async () => {
  const previous = process.env.PIPELINE_DIAGNOSTICS_ENABLED;
  delete process.env.PIPELINE_DIAGNOSTICS_ENABLED;
  const lines: string[] = [];
  const result = { sources: ["same"] };
  try {
    assert.equal(await withPipelineDiagnostics(async () => {
      recordDiagnostic("search", "empty");
      return result;
    }, { emit: (line) => lines.push(line) }), result);
    assert.equal(lines.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PIPELINE_DIAGNOSTICS_ENABLED;
    else process.env.PIPELINE_DIAGNOSTICS_ENABLED = previous;
  }
});

test("throwing log sink preserves both result and original exception identity", async () => {
  const result = { rank: 1 };
  const broken = { enabled: true, emit: () => { throw new Error("sink broken"); } };
  assert.equal(await withPipelineDiagnostics(() => withKeywordDiagnostics("same", async () => {
    recordDiagnostic("image", "favicon");
    return result;
  }), broken), result);
  const original = new Error("original");
  await assert.rejects(withPipelineDiagnostics(() => withKeywordDiagnostics("same", async () => {
    throw original;
  }), broken), (error) => error === original);
});

test("parallel keyword scopes do not mix metrics after await", async () => {
  const lines: string[] = [];
  await withPipelineDiagnostics(async () => {
    setDiagnosticSnapshot("20261014_test");
    await Promise.all([1, 2, 3].map((n) => withKeywordDiagnostics(`keyword_${n}`, async () => {
      await Promise.resolve();
      recordDiagnostic("search", "ok", { outputCount: n, requestCount: 1 });
    })));
  }, { enabled: true, emit: (line) => lines.push(line) });
  const records = parse(lines);
  for (let n = 1; n <= 3; n++) {
    const row = records.find((r) => r.keywordId === `keyword_${n}`);
    assert.equal(row.stages.search.metrics.outputCount, n);
    assert.equal(row.snapshotId, "20261014_test");
  }
  assert.equal(new Set(records.map((r) => r.runId)).size, 1);
});

test("concurrent runs use separate ids and metrics", async () => {
  const outputs: string[][] = [[], []];
  await Promise.all(outputs.map((lines, n) => withPipelineDiagnostics(async () => {
    await Promise.resolve();
    recordDiagnostic("ingestion", "ok", { outputCount: n + 1 });
  }, { enabled: true, emit: (line) => lines.push(line) })));
  assert.notEqual(parse(outputs[0])[0].runId, parse(outputs[1])[0].runId);
  assert.equal(parse(outputs[0]).at(-1).stages.ingestion.metrics.outputCount, 1);
  assert.equal(parse(outputs[1]).at(-1).stages.ingestion.metrics.outputCount, 2);
});

test("source observation never emits titles, bodies, URLs, queries or secret errors", async () => {
  const lines: string[] = [];
  const secret = "private-api-key-and-body";
  const sources = [{ url: `https://example.com/article?token=${secret}`, title: secret,
    snippet: secret, publishedAt: null, imageUrl: `https://example.com/favicon.ico?key=${secret}`,
    type: "news", provider: "origin" }];
  const before = structuredClone(sources);
  await withPipelineDiagnostics(() => withKeywordDiagnostics(`bad id ${secret}`, async () => {
    setDiagnosticSnapshot(`bad snapshot ${secret}`);
    observeSources(sources, secret, sources[0].url);
    recordDiagnostic("search", diagnosticFailure(new Error(secret)), { outputCount: 0 });
    recordDiagnostic(secret, "ok");
  }), { enabled: true, emit: (line) => lines.push(line) });
  assert.deepEqual(sources, before);
  assert.ok(!lines.join("\n").includes(secret));
  assert.ok(!lines.join("\n").includes("https://"));
  const row = parse(lines).find((r) => r.event === "keyword_finished");
  assert.equal(row.stages.selected_sources.metrics.faviconCount, 1);
  assert.equal(row.stages.selected_sources.metrics.missingDates, 1);
  assert.equal(row.sourceSetHash.length, 20);
});

test("numeric metric allowlist ignores malformed values and uses maximum HTTP status", async () => {
  const lines: string[] = [];
  await withPipelineDiagnostics(async () => {
    recordDiagnostic("search", "http_error", { maxHttpStatus: 503, durationMs: 10, outputCount: -1, requestCount: 1, unknown: 123 });
    recordDiagnostic("search", "http_error", { maxHttpStatus: 429, durationMs: 5, outputCount: Number.NaN, requestCount: 1 });
  }, { enabled: true, emit: (line) => lines.push(line) });
  assert.deepEqual(parse(lines).at(-1).stages.search.metrics, { maxHttpStatus: 503, durationMs: 15, requestCount: 2 });
});

test("output and memory bounds keep complete JSON and final run status", async () => {
  const lines: string[] = [];
  let completed = 0;
  await withPipelineDiagnostics(async () => {
    for (let i = 0; i < 50; i++) await withKeywordDiagnostics(`keyword_${i}`, async () => {
      for (let n = 0; n < 100; n++) {
        recordDiagnostic(`stage_${String.fromCharCode(97 + n % 26)}`, "ok", { inputCount: 1, outputCount: 1, durationMs: 1 });
        recordDiagnostic(`stage_${String.fromCharCode(97 + n % 26)}`, "empty", { missingDates: 1, imageCount: 1 });
      }
      completed++;
    });
  }, { enabled: true, emit: (line) => lines.push(line) });
  assert.equal(completed, 50);
  const records = parse(lines);
  assert.ok(records.filter((r) => r.event === "keyword_finished").length <= 20);
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 4096));
  assert.ok(lines.reduce((n, line) => n + Buffer.byteLength(line) + 1, 0) <= 32 * 1024);
  assert.equal(records.at(-1).event, "run_finished");
  assert.equal(records.at(-1).outcome, "ok");
  assert.equal(records.at(-1).omittedKeywords, 30);
});

test("observing source fingerprints does not sort or mutate selected sources", async () => {
  const sources = [{ url: "https://example.com/b", type: "social" }, { url: "https://example.com/a", type: "news" }, { url: "https://example.com/b", type: "social" }];
  const before = structuredClone(sources);
  const lines: string[] = [];
  await withPipelineDiagnostics(async () => observeSources(sources), { enabled: true, emit: (line) => lines.push(line) });
  assert.deepEqual(sources, before);
  assert.equal(parse(lines).at(-1).stages.selected_sources.metrics.duplicateUrls, 1);
});

test("unknown errors stay unknown and bounded error categories do not inspect messages", () => {
  assert.equal(diagnosticFailure(new Error("opaque error")), "failure");
  assert.equal(diagnosticFailure(new SyntaxError("bad JSON")), "invalid_response");
  assert.equal(diagnosticFailure({ status: 429, message: "private" }), "rate_limit");
  assert.equal(diagnosticFailure({ status: 503 }), "http_error");
  assert.equal(diagnosticFailure({ name: "AbortError" }), "timeout");
  assert.equal(diagnosticFailure({ code: "ENOTFOUND" }), "network_error");
  assert.equal(diagnosticFailure({ get name() { throw new Error("private"); } }), "failure");
});

test("observation faults do not escape into the content operation", async () => {
  const result = { same: true };
  const source = { get url(): string { throw new Error("metadata failure"); } };
  assert.equal(await withPipelineDiagnostics(async () => {
    observeSources([source]);
    recordDiagnostic("search", "ok", new Proxy({}, { ownKeys() { throw new Error("metric failure"); } }));
    return result;
  }, { enabled: true, emit: () => {} }), result);
});

test("stage names matching prototype keys do not modify shared object prototypes", async () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  await withPipelineDiagnostics(async () => {
    recordDiagnostic("__proto__", "ok", { outputCount: 1 });
    recordDiagnostic("constructor", "ok", { outputCount: 1 });
  }, { enabled: true, emit: () => {} });
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
