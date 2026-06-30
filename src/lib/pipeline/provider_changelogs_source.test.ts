import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_CHANGELOGS,
  mapProviderChangelogEntries,
} from "./provider_changelogs_source";

const CUTOFF = new Date("2026-06-08T00:00:00.000Z");

test("PROVIDER_CHANGELOGS includes official model/API providers", () => {
  assert.ok(PROVIDER_CHANGELOGS.some((config) => config.provider === "OpenAI"));
  assert.ok(PROVIDER_CHANGELOGS.some((config) => config.provider === "Anthropic"));
  assert.ok(PROVIDER_CHANGELOGS.some((config) => config.provider === "Gemini"));
  assert.ok(PROVIDER_CHANGELOGS.some((config) => config.provider === "Mistral"));
});

test("mapProviderChangelogEntries maps recent model and API entries", () => {
  const items = mapProviderChangelogEntries(
    [
      {
        title: "June 10",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        text: "MODEL RELEASED: Claude Fable 5 is now available for coding and agentic workloads.",
        url: "https://example.com/changelog",
      },
    ],
    PROVIDER_CHANGELOGS[1],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Anthropic: MODEL RELEASED: Claude Fable 5");
  assert.equal(items[0].tier, "P1_CONTEXT");
  assert.equal(items[0].sourceDomain, "platform.claude.com");
  assert.equal(items[0].feedTitle, "Anthropic Provider Changelog");
  assert.ok(items[0].summary.includes("coding and agentic workloads"));
});

test("mapProviderChangelogEntries extracts launched model names from provider prose", () => {
  const items = mapProviderChangelogEntries(
    [
      {
        title: "June 10, 2026",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        text: "We've launched Claude Fable 5 (claude-fable-5), our most capable widely released model.",
        url: "https://example.com/changelog",
      },
      {
        title: "June 10, 2026",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        text: "We announced the deprecation of Claude Opus 4.1, with retirement scheduled later.",
        url: "https://example.com/deprecation",
      },
    ],
    PROVIDER_CHANGELOGS[1],
    CUTOFF
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Anthropic: Claude Fable 5");
});

test("mapProviderChangelogEntries filters old, bugfix-only, and off-topic entries", () => {
  const items = mapProviderChangelogEntries(
    [
      {
        title: "June 7",
        publishedAt: new Date("2026-06-07T00:00:00.000Z"),
        text: "MODEL RELEASED: Old model",
        url: "https://example.com/old",
      },
      {
        title: "June 10",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        text: "Fixed a typo in the documentation.",
        url: "https://example.com/bugfix",
      },
      {
        title: "June 10",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        text: "Billing dashboard now has new invoice filters.",
        url: "https://example.com/billing",
      },
    ],
    PROVIDER_CHANGELOGS[0],
    CUTOFF
  );

  assert.equal(items.length, 0);
});
