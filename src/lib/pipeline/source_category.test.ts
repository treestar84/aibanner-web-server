import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySourceCategory,
  determinePrimaryType,
  pickPrimarySource,
} from "@/lib/pipeline/source_category";

test("classifySourceCategory keeps key social/community domains in the social bucket", () => {
  const socialCases = [
    { domain: "x.com" },
    { domain: "twitter.com" },
    { domain: "reddit.com" },
    { domain: "news.ycombinator.com" },
    { domain: "dev.to" },
    { domain: "facebook.com" },
    { domain: "instagram.com" },
    { domain: "tiktok.com" },
    { domain: "blog.naver.com" },
    { domain: "cafe.naver.com" },
    { domain: "tistory.com" },
    { domain: "brunch.co.kr" },
  ];

  for (const source of socialCases) {
    assert.equal(classifySourceCategory(source), "social", source.domain);
  }
});

test("classifySourceCategory keeps data/research/media domains out of social", () => {
  const dataCases = [
    { domain: "youtube.com" },
    { domain: "arxiv.org" },
    { domain: "huggingface.co" },
    { domain: "github.com", url: "https://github.com/org/project/releases/model.pdf" },
  ];

  for (const source of dataCases) {
    assert.equal(classifySourceCategory(source), "data", source.domain);
  }
});

test("classifySourceCategory treats ordinary publisher domains as news", () => {
  assert.equal(
    classifySourceCategory({
      domain: "example-news.com",
      url: "https://example-news.com/ai/startup-launch",
      title: "AI startup launches new agent platform",
    }),
    "news"
  );
});

test("determinePrimaryType does not promote social when news evidence exists", () => {
  const sources = [
    { type: "social", domain: "reddit.com", title: "Community discussion" },
    { type: "social", domain: "x.com", title: "Post thread" },
    { type: "news", domain: "example-news.com", title: "Reported article" },
  ];

  assert.equal(determinePrimaryType(sources), "news");
});

test("determinePrimaryType prefers data over social when data is the only non-social evidence", () => {
  const sources = [
    { type: "social", domain: "reddit.com", title: "Community discussion" },
    { type: "social", domain: "dev.to", title: "Developer post" },
    { type: "data", domain: "arxiv.org", title: "Research paper" },
  ];

  assert.equal(determinePrimaryType(sources), "data");
});

test("pickPrimarySource selects a non-social representative after social demotion", () => {
  const sources = [
    { type: "social", domain: "reddit.com", title: "Community discussion" },
    { type: "social", domain: "x.com", title: "Post thread" },
    { type: "news", domain: "example-news.com", title: "Reported article" },
  ];
  const primaryType = determinePrimaryType(sources);

  assert.equal(primaryType, "news");
  assert.equal(pickPrimarySource(sources, primaryType)?.domain, "example-news.com");
});

