import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuditQualityFixtures,
  summarizeQualityReplay,
} from "@/lib/admin/ranking_quality_replay";

test("summarizeQualityReplay retains protected audit fixtures and demotes known noise", () => {
  // Given: audited realtime ranking examples without any production DB dependency.
  const fixtures = buildAuditQualityFixtures();
  const before = fixtures.map((fixture, index) => ({
    keyword_normalized: fixture.keyword_normalized,
    rank: index + 1,
  }));
  const after = fixtures.map((fixture, index) => ({
    keyword_normalized: fixture.keyword_normalized,
    rank: fixture.expected_quality === "known_noise" ? index + 8 : index + 1,
  }));

  // When: replay output is summarized against the expected quality classes.
  const summary = summarizeQualityReplay(fixtures, before, after);

  // Then: the fixture covers enough good/noise cases and classifies movement.
  assert.equal(summary.protectedGoodCount >= 6, true);
  assert.equal(summary.knownNoiseCount >= 5, true);
  assert.equal(summary.protectedGoodRetained, summary.protectedGoodCount);
  assert.equal(summary.knownNoiseDemotedOrHidden, summary.knownNoiseCount);
});

test("buildAuditQualityFixtures includes score, source, date, count, and expected class", () => {
  // Given: the audited quality fixture set.
  const fixtures = buildAuditQualityFixtures();

  // When: fixture rows are inspected.
  const fixtureWithRequiredFields = fixtures.every((fixture) => {
    return (
      fixture.keyword.length > 0 &&
      fixture.keyword_normalized.length > 0 &&
      typeof fixture.total_score === "number" &&
      typeof fixture.score_recency === "number" &&
      typeof fixture.score_velocity === "number" &&
      typeof fixture.source_count === "number" &&
      fixture.expected_quality.length > 0 &&
      fixture.quality_notes.length > 0 &&
      "top_source_url" in fixture &&
      "latest_source_at" in fixture
    );
  });

  // Then: every fixture has the audit fields needed by later policy tests.
  assert.equal(fixtureWithRequiredFields, true);
});
