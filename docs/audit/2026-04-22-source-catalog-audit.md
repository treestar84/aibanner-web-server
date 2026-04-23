# Subtask A — RSS / 외부 소스 카탈로그 감사 (2026-04-22)

> 작성자: worker-1 · 대상: `realtime-ai-trend-news` (web-server)
> 범위: 코드 변경 금지 · 분석/권고만 · 산출물 언어: 한국어
> 평가 기준 등급: 1(최하) ~ 5(최상)

## 0. 요약(Executive Summary)

- 현재 파이프라인은 **총 8개 수집 경로**(RSS 33 피드 + GDELT API + HackerNews Algolia API + YouTube 채널 19 + YouTube 추천 DB 채널 N + Changelog 스크레이프 5 + GitHub Search/Releases/MD 3 + Product Hunt GraphQL + Reddit 9 서브레딧)로 **대량 후보**를 만든다.
- **바이브코딩 적합성**은 "있는 척"하는 경향이 큼. 공식/리서치 경량 신호(MIT Tech Review, arXiv 등)는 과소·불필요하게 포함되어 있고, 정작 **바이브코딩의 심장부**인 Cursor/Windsurf/Zed/Claude Code/Replit/v0 등 에디터·플랫폼 **공식 릴리스 RSS**, GitHub Trending, Show HN, Indie Hackers, r/SideProject/r/LocalLLaMA 2개가 모두 **부분만 존재**하거나 빠져 있다.
- **한국어 매체 비중**은 전체 피드 37개 중 **4개**(GeekNews, ZDNet Korea, GENEXIS DailyNews, 한국 YouTube 4채널) 수준으로 낮다. 특히 "바이브코딩을 즐기는 한국 사용자"가 선호할 **토스 테크 / 우아한 형제 / 카카오 기술 블로그 / 네이버 D2 / 요즘IT / Outsider's dev / 디스콰이엇 / 안될공학 / 잇타**가 전면적으로 빠져 있어 한국 유저 만족도 저하 원인이 된다.
- **제거 권장**: `hnrss.org/newest?q=LLM+AI`(HN 재중복), `Ben's Bites`(발행 중단 가능성·5점 테스트 필요), `LogRocket Blog`(노이즈 과다), `Phoronix`(AI 트렌드 적합성 낮음). `Ars Technica AI`는 일반 IT·연예화 경향이 있어 COMMUNITY tier 강등.
- **우선 도입 권고**: (i) 바이브코딩 에디터 Changelog 5종 + (ii) GitHub Trending / Show HN / Indie Hackers RSS + (iii) 한국 기술 블로그 5종 + (iv) X(Twitter) / Threads의 공식 서드파티(RSSHub) 라우트 — 총 15~18 소스.

---

## 1. 현재 소스 카탈로그 (What's being called now)

### 1.1 RSS 피드 — `src/lib/pipeline/rss.ts` RSS_FEEDS

| # | Feed Title | URL | Tier | 언어 | 코드 근거 |
|---|---|---|---|---|---|
| 1 | OpenAI Blog | https://openai.com/blog/rss.xml | P0_CURATED | en | `rss.ts:41` |
| 2 | Anthropic Blog | https://www.anthropic.com/rss.xml | P0_CURATED | en | `rss.ts:42` |
| 3 | HuggingFace Blog | https://huggingface.co/blog/feed.xml | P0_CURATED | en | `rss.ts:43` |
| 4 | Google Research Blog | https://research.google/blog/rss/ | P0_CURATED | en | `rss.ts:44` |
| 5 | TLDR AI | https://bullrich.dev/tldr-rss/ai.rss | P0_CURATED | en | `rss.ts:45` |
| 6 | MIT Technology Review | https://www.technologyreview.com/feed/ | P0_CURATED | en | `rss.ts:46` |
| 7 | HF Daily Papers (Takara) | https://papers.takara.ai/api/feed | P0_CURATED | en | `rss.ts:48` |
| 8 | Ben's Bites | https://www.bensbites.com/feed | P0_CURATED | en | `rss.ts:50` |
| 9 | GitHub Blog | https://github.blog/feed/ | P0_CURATED | en | `rss.ts:52` |
| 10 | TechCrunch AI | https://techcrunch.com/category/artificial-intelligence/feed/ | P1_CONTEXT | en | `rss.ts:55` |
| 11 | VentureBeat AI | https://venturebeat.com/category/ai/feed/ | P1_CONTEXT | en | `rss.ts:56` |
| 12 | The Verge AI | https://www.theverge.com/ai-artificial-intelligence/rss/index.xml | P1_CONTEXT | en | `rss.ts:57` |
| 13 | Ars Technica AI | https://arstechnica.com/ai/feed/ | P1_CONTEXT | en | `rss.ts:58` |
| 14 | TensorFeed | https://tensorfeed.ai/feed.xml | P1_CONTEXT | en | `rss.ts:59` |
| 15 | Simon Willison | https://simonwillison.net/atom/everything/ | P1_CONTEXT | en | `rss.ts:60` |
| 16 | Latent Space | https://www.latent.space/feed | P1_CONTEXT | en | `rss.ts:61` |
| 17 | SemiAnalysis | https://www.semianalysis.com/feed | P1_CONTEXT | en | `rss.ts:62` |
| 18 | Last Week in AI | https://lastweekin.ai/feed | P1_CONTEXT | en | `rss.ts:63` |
| 19 | Interconnects | https://www.interconnects.ai/feed | P1_CONTEXT | en | `rss.ts:64` |
| 20 | NVIDIA Technical Blog | https://developer.nvidia.com/blog/feed | P1_CONTEXT | en | `rss.ts:65` |
| 21 | GeekNews | https://news.hada.io/rss/news | P1_CONTEXT | **ko** | `rss.ts:66` |
| 22 | LangChain Changelog | https://changelog.langchain.com/feed | P1_CONTEXT | en | `rss.ts:68` |
| 23 | CrewAI Releases | https://github.com/crewAIInc/crewAI/releases.atom | P1_CONTEXT | en | `rss.ts:69` |
| 24 | Lobsters | https://lobste.rs/rss | P1_CONTEXT | en | `rss.ts:71` |
| 25 | Changelog | https://changelog.com/feed | P1_CONTEXT | en | `rss.ts:72` |
| 26 | LogRocket Blog | https://blog.logrocket.com/feed/ | P1_CONTEXT | en | `rss.ts:73` |
| 27 | Phoronix | https://www.phoronix.com/rss.php | P1_CONTEXT | en | `rss.ts:74` |
| 28 | Product Hunt (RSS) | https://www.producthunt.com/feed | P1_CONTEXT | en | `rss.ts:75` |
| 29 | Vercel Blog | https://vercel.com/atom | P1_CONTEXT | en | `rss.ts:77` |
| 30 | Sourcegraph Blog | https://sourcegraph.com/blog/rss.xml | P1_CONTEXT | en | `rss.ts:79` |
| 31 | Sebastian Raschka | https://sebastianraschka.com/rss_feed.xml | P1_CONTEXT | en | `rss.ts:81` |
| 32 | The Pragmatic Engineer | https://newsletter.pragmaticengineer.com/feed | P1_CONTEXT | en | `rss.ts:83` |
| 33 | 宝玉 baoyu.io | https://baoyu.io/feed.xml | P1_CONTEXT | en(표기)/zh 혼합 | `rss.ts:85` |
| 34 | ZDNet Korea | https://zdnet.co.kr/rss/news.xml | P2_RAW | **ko** | `rss.ts:90` |
| 35 | Dev.to AI | https://dev.to/feed/tag/ai | COMMUNITY | en | `rss.ts:93` |
| 36 | Dev.to Vibe Coding | https://dev.to/feed/tag/vibecoding | COMMUNITY | en | `rss.ts:94` |
| 37 | Towards AI | https://towardsai.net/feed | COMMUNITY | en | `rss.ts:95` |
| 38 | HackerNews AI (hnrss) | https://hnrss.org/newest?q=LLM+AI | COMMUNITY | en | `rss.ts:96` |

집계: 총 **38 피드** (영문 35 / 한글 2 / 중·영 혼합 1). P0=9 / P1=24 / P2=1 / COMMUNITY=4.

> **주의**: `rss.ts:88~89` 주석에 따르면 `AI타임스`와 `전자신문 AI`는 각각 RSS 404 / WAF 차단으로 **제거됨**. 테스트 파일 `rss_feeds.test.ts:83~91`도 제거 상태를 고정.

### 1.2 RSS 외 수집 소스 (코드 기반)

| 경로 | 진입점 | 엔드포인트/대상 | Tier 귀속 | 코드 근거 |
|---|---|---|---|---|
| GDELT Doc API | `gdelt_source.ts` | `https://api.gdeltproject.org/api/v2/doc/doc` — dynamic query(`buildDynamicQuery`) 72h 윈도우, max 250건 | P1_CONTEXT (하드코딩) | `gdelt_source.ts:52,76` |
| HackerNews Algolia | `hn_source.ts` | `/api/v1/search?tags=front_page` + `/api/v1/search_by_date?query=...&tags=story` | front_page=P1_CONTEXT, search=COMMUNITY | `hn_source.ts:44,69` |
| YouTube RSS (채널) | `youtube_source.ts` | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` × **19 채널** | COMMUNITY (하드코딩) | `youtube_source.ts:11-34,71` |
| YouTube 추천(DB 기반) | `youtube_recommend_source.ts` | DB `youtube_videos` 테이블에 저장(랭킹 파이프라인과 분리) | — | `youtube_recommend_source.ts:86-99` |
| Changelog 스크레이프 | `changelog_source.ts` | OpenAI Dev / Cursor / Warp / Gemini API / OpenRouter HTML 파싱 | P0 1 · P1 4 | `changelog_source.ts:134-170` |
| GitHub Search API | `github_source.ts` | `/search/repositories?q=<query> pushed:>=<date>`, PAT 필수 | COMMUNITY | `github_source.ts:44,67` |
| GitHub Releases | `github_releases_source.ts` | 15 고정 리포의 `/releases`, PAT 필수 | P1_CONTEXT | `github_releases_source.ts:5-21,73` |
| GitHub MD folder | `github_md_source.ts` | `GENEXIS-AI/DailyNews/뉴스레터/*.md` 링크 추출(X/Threads 스킵) | P0_CURATED | `github_md_source.ts:3-7,53` |
| Product Hunt GraphQL | `product_hunt_top_source.ts` | `https://api.producthunt.com/v2/api/graphql`, **AI/Dev 필터 & 퍼시픽 오늘의 Top만** | P1_CONTEXT(ranking signal 부여) | `product_hunt_top_source.ts:219-248` |
| Reddit JSON | `reddit_source.ts` | 9 서브레딧 `hot` + `rising` 병렬 | COMMUNITY | `reddit_source.ts:3-13,59-72` |

**YouTube 채널 19개 상세**

| # | 이름 | channelId | 한/영 |
|---|---|---|---|
| 1 | OpenAI | UCXZCJLdBC09xxGZ6gcdrc6A | en |
| 2 | Anthropic | UCrDwWp7EBBv4NwvScIpBDOA | en |
| 3 | Google DeepMind | UCP7jMXSY2xbc3KCAE0MHQ-A | en |
| 4 | GitHub | UC8butISFwT-Wl7EV0hUK0BQ | en |
| 5 | Matt Wolfe | UChpleBmo18P08aKCIgti38g | en |
| 6 | Wes Roth | UCqcbQf6yw5KzRoDDcZ_wBSw | en |
| 7 | Cole Medin | UCMwVTLZIRRUyyVrkjDpn4pA | en |
| 8 | AI Explained | UCNJ1Ymd5yFuUPtn21xtRbbw | en |
| 9 | IndyDevDan | UC_x36zCEGilGpB1m-V4gmjg | en |
| 10 | McKay Wrigley | UCXZFVVCFahewxr3est7aT7Q | en |
| 11 | Fireship | UCsBjURrPoezykLs9EqgamOA | en |
| 12 | The AI Advantage | UCHhYXsLBEVVnbvsq57n1MTQ | en |
| 13 | World of AI | UCjqXiO67iUfqD5RppPXIqqg | en |
| 14 | EricWTech | UCOXRjenlq9PmlTqd_JhAbMQ | en |
| 15 | Evan Does AI | UCw_B1AMdUph-BVZ2ZC6do7A | en |
| 16 | 테디노트 TeddyNote | UCt2wAAXgm87ACiQnDHQEW6Q | **ko** |
| 17 | 조코딩 JoCoding | UCQNE2JmbasNYbjGAcuBiRRg | **ko** |
| 18 | 빌더 조쉬 Builder Josh | UCxj3eVTAv9KLdrowXcuCFDQ | **ko** |
| 19 | 코드팩토리 | UCxZ2AlaT0hOmxzZVbF_j_Sw | **ko** |

**GitHub Releases 고정 리포 15개**: ollama/ollama, langchain-ai/langchain, crewAIInc/crewAI, microsoft/autogen, run-llama/llama_index, vllm-project/vllm, huggingface/transformers, ggml-org/llama.cpp, LadybirdBrowser/ladybird, anthropics/claude-code, vercel/ai, openai/openai-python, google/generative-ai-python, All-Hands-AI/OpenHands, continuedev/continue (`github_releases_source.ts:5-21`).

**Reddit 서브레딧 9개**: MachineLearning, artificial, LocalLLaMA, vibecoding, PromptEngineering, cursor, ClaudeAI, ChatGPTCoding, ollama (`reddit_source.ts:3-13`).

**Changelog 5종**: OpenAI Developers, Cursor, Warp, Gemini API, OpenRouter (`changelog_source.ts:134-170`).

### 1.3 `_pipeline_reference/workflow/resources/rss.json` 대비 (과거 시드)

`rss.json`은 **한층 풍부**한 소스 셋(카테고리 5그룹, 40+ 피드)을 정의하지만 **현재 코드는 이 JSON을 읽지 않음**. 핵심 누락:

- P0_RELEASES에 정의된 **GitHub Releases 13종**(vLLM, llama.cpp, ollama, Transformers, LangChain, LlamaIndex, LiteLLM, Open WebUI, AutoGen, Vercel AI SDK, Aider, Continue, OpenHands) 중 **Aider, LiteLLM, Open WebUI** 3종은 `github_releases_source.ts` 고정 리스트에서 누락. (`rss.json:286-299` vs `github_releases_source.ts:5-21`)
- `Latent Space Podcast`(오디오), `TheSequence`, `The Batch (DeepLearning.AI)`, `Import AI (Jack Clark)`, `The Gradient` 같은 **큐레이션 뉴스레터**가 현재 `rss.ts`에서 누락. (`rss.json:306-317`)
- 한국 시드의 **토스 기술 블로그**, **Bloter AI**, **GeekNews Blog** 도 `rss.json`에는 있으나 `rss.ts`에는 없음. (`rss.json:253-268, 243-251`)
- arXiv `cs.AI/cs.LG/cs.CL/cs.SE` 4종이 시드에는 있지만 현재 수집 경로에서 **완전히 빠져 있음**. (`rss.json:346-351`)
- `topic_whitelist_keywords` / `soft_penalty_keywords` / `diversity_quotas` 등 필터·쿼터 정책이 시드에는 정의되어 있으나 실제 파이프라인은 `keyword_exclusions.ts` 수준에서만 단순 제외.

---

## 2. 소스별 평가 (적합성 / 신뢰성 / 신선도 / 중복 위험)

> 기준: (a) 바이브코딩·AI 트렌드 **적합성** — 사용자가 핵심 관심 갖는 주제 비율. (b) **신뢰성·노이즈비율**(1=거의 스팸, 5=팩트 검증된 큐레이션). (c) **신선도**(업데이트 주기). (d) **중복 위험**(동일 정보가 다른 피드와 얼마나 겹치는가, 1=중복 많음, 5=고유 정보 위주).

### 2.1 P0_CURATED (9)

| Feed | (a)적합성 | (b)신뢰성 | (c)신선도 | (d)독창성 | 종합 의견 |
|---|---|---|---|---|---|
| OpenAI Blog | 5 | 5 | 4 | 5 | 릴리스 소식 1차 공식, 필수 유지 |
| Anthropic Blog | 5 | 5 | 3 | 5 | 포스팅 빈도는 낮으나 Claude 업데이트 원천 |
| HuggingFace Blog | 4 | 4 | 4 | 4 | 모델/데이터셋 생태계, 일부 마케팅성 포함 |
| Google Research Blog | 3 | 5 | 2 | 4 | 적합도 중간·발행 빈도 낮음 |
| TLDR AI | 5 | 4 | 5 | 3 | 매우 고밀도. 다만 타 뉴스레터와 기사 중복 큼 |
| MIT Technology Review | 3 | 5 | 3 | 4 | 장문 분석. 바이브코딩 직결성 약함 |
| HF Daily Papers (Takara) | 2 | 4 | 5 | 3 | 학술 편향. 바이브코딩 유저 만족도에는 간접 기여 |
| Ben's Bites | 4 | 4 | 3 | 2 | **발행 상태 확인 필요**(비주류 기간 존재). TLDR과 중복 큼 |
| GitHub Blog | 4 | 5 | 3 | 5 | Copilot·Actions·Codespaces 등 바이브코딩 직결 |

### 2.2 P1_CONTEXT (24)

| Feed | (a) | (b) | (c) | (d) | 의견 |
|---|---|---|---|---|---|
| TechCrunch AI | 3 | 3 | 5 | 2 | 자금조달·PR 성격 기사 편향 |
| VentureBeat AI | 3 | 3 | 5 | 2 | TechCrunch와 상당 중복 |
| The Verge AI | 3 | 3 | 5 | 2 | 소비자 제품·연예화 경향 |
| Ars Technica AI | 3 | 4 | 4 | 3 | 기술 분석 OK. 다만 AI 코딩보단 일반 IT |
| TensorFeed | 4 | 4 | 4 | 4 | 큐레이션 품질 양호. 유지 |
| Simon Willison | 5 | 5 | 5 | 5 | 바이브코딩/LLM 실험 일기, **최상위 유지** |
| Latent Space | 5 | 5 | 4 | 5 | AI 엔지니어 허브 |
| SemiAnalysis | 3 | 5 | 3 | 5 | 인프라 심층 분석 — 부가가치 높으나 사용자 친화도 낮음 |
| Last Week in AI | 4 | 4 | 3 | 2 | 주간 — 타 뉴스레터와 겹침 큼 |
| Interconnects | 4 | 5 | 4 | 4 | Nathan Lambert — RL/post-training 시그널 |
| NVIDIA Technical Blog | 3 | 5 | 3 | 4 | 인프라/CUDA — 바이브코더 직결성 낮음 |
| GeekNews (ko) | 5 | 5 | 5 | 5 | **한국 사용자 관점 필수 유지** |
| LangChain Changelog | 4 | 5 | 4 | 5 | 프레임워크 변경 이력. 유지 |
| CrewAI Releases | 3 | 5 | 3 | 5 | 에이전트 프레임워크. 유지 |
| Lobsters | 4 | 4 | 5 | 4 | HN 대비 개발자 편향 |
| Changelog | 3 | 4 | 3 | 3 | 팟캐스트 RSS. 바이브코딩 간접 |
| LogRocket Blog | 2 | 3 | 5 | 1 | **콘텐츠 마케팅 편향**, 랭킹 오염 |
| Phoronix | 1 | 4 | 5 | 4 | 리눅스 벤치마크 중심. AI와 무관한 항목 다수 |
| Product Hunt (RSS) | 3 | 3 | 5 | 2 | Product Hunt GraphQL 경로로 **중복**, RSS는 해제 권고 |
| Vercel Blog | 4 | 5 | 3 | 4 | v0/AI SDK 발표 원천 |
| Sourcegraph Blog | 3 | 5 | 3 | 5 | Cody·코드 검색. 바이브코딩 연관 |
| Sebastian Raschka | 4 | 5 | 3 | 5 | LLM 학습 원리 |
| The Pragmatic Engineer | 4 | 5 | 3 | 4 | 업계 트렌드·AI 도입 사례 |
| 宝玉 baoyu.io | 3 | 4 | 5 | 4 | 프롬프트 엔지니어링, 언어 라벨 `en`이지만 실제 **중·영 혼용**(`rss.ts:85`) → 로케일 처리 점검 필요 |

### 2.3 P2_RAW / COMMUNITY

| Feed | (a) | (b) | (c) | (d) | 의견 |
|---|---|---|---|---|---|
| ZDNet Korea (ko) | 3 | 3 | 5 | 3 | 한국어 IT 일반. AI 전용 섹션 RSS 추가 필요 |
| Dev.to AI | 3 | 3 | 5 | 3 | SEO용 얕은 글 다수. 필터 강화 필요 |
| Dev.to Vibe Coding | 4 | 3 | 4 | 3 | 태그 매칭 — 유저 의도와 일치 |
| Towards AI | 3 | 3 | 5 | 2 | Medium계 반복 포스팅 |
| HackerNews AI (hnrss) | 2 | 3 | 5 | **1** | `hn_source.ts`와 **완전 중복**, 제거 권고 |

### 2.4 비-RSS 경로

| 소스 | (a) | (b) | (c) | (d) | 의견 |
|---|---|---|---|---|---|
| GDELT | 3 | 3 | 5 | 3 | 영어 편향, 타블로이드 다수. `language=Korean`만 `ko`로 라벨(`gdelt_source.ts:77`) |
| HN front_page + search | 5 | 4 | 5 | 4 | 바이브코더 핵심 동선 |
| YouTube 채널(영문 15) | 4 | 3 | 4 | 3 | 인플루언서 다수 — 스폰서 콘텐츠 리스크 |
| YouTube 채널(한글 4) | 5 | 4 | 4 | 5 | **한국 바이브코더에게 가장 중요**. 채널 수 확장 여지 큼 |
| Changelog 5종 | 5 | 5 | 3 | 5 | 에디터·모델 API 공식 변경이력 — 코어 신호 |
| GitHub Search | 4 | 3 | 5 | 3 | `pushed:` 기반. 스팸 레포 유입 방지 필터 필요 |
| GitHub Releases 15 | 5 | 5 | 3 | 5 | **바이브코딩 인프라** 릴리스 — 유지·확장 |
| GitHub MD(GENEXIS) | 4 | 4 | 3 | 4 | 한국어 요약 중요. 소스 유지율 모니터 필요 |
| Product Hunt GraphQL | 4 | 3 | 5 | 4 | AI/Dev 필터·퍼시픽 오늘 Top 한정(`product_hunt_top_source.ts:219-221`) — 품질 관리 우수 |
| Reddit 9 서브 | 4 | 3 | 5 | 4 | r/vibecoding·r/cursor·r/ClaudeAI·r/ChatGPTCoding — 바이브코더 핵심 커뮤니티. rate limit 1s(`reddit_source.ts:108-110`) |

---

## 3. 누락 핵심 소스 추천 (Add)

### 3.1 추천 Tier 결정 원칙
- **P0_CURATED**: 공식·발행처 1차 소스, 바이브코딩 핵심 도구 원천.
- **P0_RELEASES**: GitHub Releases 확장(별도 tier 권고 — 현재 P1_CONTEXT로 묶여있음).
- **P1_CONTEXT**: 해설·맥락(큐레이션 뉴스레터·분석 블로그).
- **COMMUNITY**: 디스커버리. 필터 강화 필수.

### 3.2 바이브코딩 에디터·AI IDE Changelog / Blog (최우선)

| 추천 소스 | URL 후보 | Tier | 도입 근거 | 예상 노이즈 | 우선순위 |
|---|---|---|---|---|---|
| Cursor Blog | `https://cursor.com/blog/rss.xml` (공식 RSS 없으면 스크레이프) | P0_CURATED | 현재 Changelog만 스크레이프, **제품 기획·릴리스 기사 미수집** | 낮음 | ★★★ |
| Windsurf Changelog/Blog | `https://docs.codeium.com/changelog/windsurf.xml` (확인 필요) | P0_CURATED | 커서의 최대 경쟁, 누락 시 유저 인지 격차 | 낮음 | ★★★ |
| Zed Blog | `https://zed.dev/blog.rss` | P0_CURATED | Agentic editor 대표 | 낮음 | ★★★ |
| Replit Blog | `https://blog.replit.com/rss` | P0_CURATED | Replit Agent — 바이브코딩 입문자 다수 | 낮음 | ★★★ |
| v0 / Vercel Ship | `https://vercel.com/changelog/rss.xml` | P0_CURATED | v0·AI SDK 주요 발표 | 낮음 | ★★★ |
| Supabase Blog (AI태그) | `https://supabase.com/feed.xml` | P1_CONTEXT | pgvector·Edge AI 통합 시 바이브코더 영향 | 낮음 | ★★ |
| LangSmith/LangGraph 릴리스 | GitHub Releases atom | P0_RELEASES | 이미 LangChain은 있으나 LangGraph는 별도 | 낮음 | ★★ |
| Claude Code Releases | `https://github.com/anthropics/claude-code/releases.atom` (이미 포함됨) | 유지 | `github_releases_source.ts:15` | — | — |
| OpenHands Releases | 이미 포함됨 | 유지 | `github_releases_source.ts:19` | — | — |
| Aider Releases | `https://github.com/Aider-AI/aider/releases.atom` | P0_RELEASES | `rss.json:296`에 있으나 코드에 **누락** | 낮음 | ★★★ |
| LiteLLM Releases | `https://github.com/BerriAI/litellm/releases.atom` | P0_RELEASES | `rss.json:292`에 있으나 코드에 **누락** | 낮음 | ★★ |
| Open WebUI Releases | `https://github.com/open-webui/open-webui/releases.atom` | P0_RELEASES | `rss.json:293`에 있으나 코드에 **누락** | 낮음 | ★★ |

### 3.3 AI 랩 / 모델 1차 소스

| 추천 | URL 후보 | Tier | 근거 | 우선순위 |
|---|---|---|---|---|
| Mistral AI News | `https://mistral.ai/news/rss.xml` (미존재 시 스크레이프) | P0_CURATED | 오픈웨이트 주요 플레이어 | ★★★ |
| Meta AI Blog | `https://ai.meta.com/blog/rss/` | P0_CURATED | Llama 라인 | ★★★ |
| xAI Blog | `https://x.ai/blog` | P0_CURATED | Grok | ★★ |
| Qwen(알리바바) Blog | `https://qwenlm.github.io/feed.xml` | P0_CURATED | 중국 오픈웨이트 선도 | ★★ |
| 01.AI / DeepSeek | `https://api-docs.deepseek.com/news/rss` | P0_CURATED | 저비용 코드 모델 | ★★★ |

### 3.4 커뮤니티·디스커버리(바이브코딩 직결)

| 추천 | URL 후보 | Tier | 근거 | 예상 노이즈 | 우선순위 |
|---|---|---|---|---|---|
| GitHub Trending (daily/weekly) | `https://github.com/trending?since=daily` → 비공식 atom `https://trendshift.io/rss/top/` 또는 `https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml` | COMMUNITY | 바이브코더가 매일 체크. 스타 급상승 시그널. | 중 — 스팸 레포 주의 | ★★★ |
| Show HN (`hnrss.org/show`) | `https://hnrss.org/show?points=30` | COMMUNITY | 인디 런칭의 HN 무대. `hn_source.ts` search와 별개 태그 | 낮음 | ★★★ |
| Indie Hackers Posts | `https://www.indiehackers.com/latest.rss`(RSSHub 대체) | COMMUNITY | 바이브코더의 "제품" 측면 | 중 | ★★ |
| r/SideProject | reddit_source 확장 | COMMUNITY | 바이브코더 제품 쇼케이스 | 중 | ★★★ |
| r/LocalLLaMA / r/OpenAI / r/Singularity | reddit_source 확장 | COMMUNITY | r/LocalLLaMA 누락은 명백한 누수 | 낮음~중 | ★★★ |
| Lobste.rs (`tag:ai`·`tag:ml`) | `https://lobste.rs/t/ai.rss` | COMMUNITY | 이미 전체 Lobsters 포함. 태그 필터가 효율적 | 낮음 | ★★ |
| Product Hunt 일간(외) | 이미 GraphQL 사용 | — | RSS 중복 제거 | — | — |
| Hugging Face Spaces Trending | `https://huggingface.co/spaces?sort=trending` 스크레이프 | COMMUNITY | 실전 AI 앱 쇼케이스 | 중 | ★ |

### 3.5 뉴스레터·분석 (큐레이션)

| 추천 | URL | Tier | 근거 | 우선순위 |
|---|---|---|---|---|
| The Batch (DeepLearning.AI) | `https://www.deeplearning.ai/the-batch/feed/` | P1_CONTEXT | `rss.json:306` 제시, 현재 누락 | ★★ |
| Import AI (Jack Clark) | `https://importai.substack.com/feed` | P1_CONTEXT | `rss.json:308` 제시, 현재 누락 | ★★ |
| TheSequence | `https://thesequence.substack.com/feed` | P1_CONTEXT | `rss.json:307` 제시, 현재 누락 | ★ |
| AI Coding Weekly (Swyx·Latent Space) | 이미 Latent Space 포함 | — | — | — |
| Dwarkesh Podcast | `https://www.dwarkeshpatel.com/feed` | P1_CONTEXT | 인터뷰 오픈, AI 커뮤니티 공감대 | ★ |

### 3.6 한국어 매체 (한국 사용자 만족 핵심)

| 추천 | URL 후보 | Tier | 근거 | 우선순위 |
|---|---|---|---|---|
| 토스 기술 블로그 | `https://toss.tech/rss.xml` | P0_CURATED | `rss.json:253` 있으나 코드 누락. LLM 적용 사례 풍부 | ★★★ |
| 우아한 형제들 기술 블로그 | `https://techblog.woowahan.com/feed/` | P0_CURATED | AI/DevEx 콘텐츠 증가 | ★★★ |
| 카카오 기술 블로그 | `https://tech.kakao.com/feed/` | P1_CONTEXT | KoGPT·LLM 한국어 | ★★ |
| 네이버 D2 | `https://d2.naver.com/d2.atom` | P1_CONTEXT | 플랫폼 기술 | ★★ |
| 요즘IT | `https://yozm.wishket.com/magazine/rss/` | P1_CONTEXT | AI 관점 대중화 | ★★ |
| GeekNews Blog | `https://news.hada.io/rss/blog` | P0_CURATED | `rss.json:243`에 있으나 코드 누락 | ★★★ |
| Bloter AI | `https://www.bloter.net/archives/category/ai/feed` | P1_CONTEXT | `rss.json:264` 있으나 코드 누락 | ★★ |
| 디스콰이엇(Disquiet) | `https://disquiet.io/rss.xml`(가용성 확인 필요) | COMMUNITY | 한국 바이브코더 커뮤니티 | ★★ |
| 안될공학 YouTube | 채널 ID 추가 필요 | COMMUNITY | AI/개발 인기 채널 | ★★ |
| 잇타 (ITTA) | RSS 확인 | P1_CONTEXT | 최신 AI 도구 한국어 소개 | ★ |

### 3.7 SNS 통합 (Subtask C와 접점이지만 소스 카탈로그 관점)

| 추천 | 경로 | Tier | 근거 | 리스크 |
|---|---|---|---|---|
| X(Twitter) 주요 계정 타임라인 | RSSHub `rsshub.app/twitter/user/<id>` 또는 `nitter.net` RSS | COMMUNITY | @sama, @karpathy, @simonw, @amasad, @openaidevs 등 AI/바이브코딩 오피니언 리더 | 서드파티 가용성 변동·ToS 이슈 — Subtask C에서 결정 |
| Threads 검색 | RSSHub `rsshub.app/threads/tag/vibecoding` | COMMUNITY | 한국 Threads 활성 | 동일 |

---

## 4. 제거·교체 권장 (Prune / Replace)

| # | 대상 | 제안 | 사유 | 근거 |
|---|---|---|---|---|
| R1 | `HackerNews AI (hnrss)` | **제거** | `hn_source.ts`가 이미 HN Algolia로 dynamic query 수집 + front_page까지 포함하여 완전 중복. RSS 키워드 `LLM+AI` 매칭이 `buildDynamicQuery`보다 좁음. | `rss.ts:96` vs `hn_source.ts:51-78` |
| R2 | `Product Hunt (RSS)` | **제거 또는 뉴스 비 AI 필터** | `product_hunt_top_source.ts`가 GraphQL로 더 엄격한 AI/Dev 필터 + 퍼시픽 오늘 Top 제한을 함. RSS는 전 카테고리 뉴스 유입으로 노이즈. | `rss.ts:75` vs `product_hunt_top_source.ts:218-222` |
| R3 | `LogRocket Blog` | **제거** | 자사 제품 마케팅 중심, AI 트렌드 기여도 낮음 | `rss.ts:73` |
| R4 | `Phoronix` | **제거** | 리눅스 벤치마크 뉴스 — AI/바이브코딩 시그널 빈도 매우 낮고 Kernel/GPU 드라이버 소음이 키워드 풀 오염 | `rss.ts:74` |
| R5 | `Ars Technica AI` | **COMMUNITY로 강등 또는 스코어 하향** | 기술 품질 OK지만 AI 섹션 실제 기사량 적고 일반 IT/문화 기사가 섞여 들어옴 | `rss.ts:58` |
| R6 | `Ben's Bites` | **확인 후 유지/교체** | 발행 공백기 존재. 죽었으면 `Last Week in AI` 또는 `The Batch`로 교체 | `rss.ts:50` |
| R7 | `Google Research Blog` (P0) | **P1로 강등** | 포스팅 빈도 매우 낮고, 바이브코더 직결 콘텐츠는 제한적. DeepMind/Gemini Changelog가 대체 | `rss.ts:44` |
| R8 | `MIT Technology Review` (P0) | **P1로 강등** | 일반 기술 저널. 트렌드 긴급도·신선도 낮음 | `rss.ts:46` |
| R9 | `ZDNet Korea` (P2, 전체 뉴스) | **ZDNet Korea AI 섹션으로 교체** 예: `https://zdnet.co.kr/section/rss/?section_key=20` | 전체 피드는 게임·연예 기사 유입 | `rss.ts:90` |
| R10 | `HF Daily Papers (Takara)` | **옵트인 모드(연구 쿼터)로 분리** | 학술 편향, 일상 바이브코더 만족도 낮음. `rss.json:143-154` diversity_quotas `max.Research=3`처럼 상한 필요 | `rss.ts:48` |
| R11 | `YouTube GitHub 채널` | **유지**(OK) — 단 공식 GitHub 블로그 RSS와 겹침 모니터 | — | `youtube_source.ts:16` |
| R12 | `hard-coded YOUTUBE_CHANNELS` | **DB화 고려** | `youtube_recommend_source.ts`처럼 DB 테이블로 이관하면 한국 채널 확장이 쉬워짐 | `youtube_source.ts:11-34` |

> **주의**: 제거·강등은 스코어 가중치(`scoring.ts`)와 tier별 `source_weights`(`rss.json:156-162`)에도 영향. Subtask B(점수/랭킹)와 정합 필요.

---

## 5. 한국어 매체 비중 & 한국 사용자 만족 갭

### 5.1 현황 수치

- 명시적 `lang: "ko"` 표기 피드: **2 (GeekNews, ZDNet Korea)** / 38 RSS = **5.3%**
- 한국어 YouTube 채널: **4 / 19 = 21.0%**
- Changelog 스크레이프 한국어: **0 / 5**
- GitHub MD(GENEXIS) 한국어 요약: **1 / 1** (`github_md_source.ts:54` `lang: "ko"`)
- Reddit/HN/Lobsters/Dev.to: **전부 영어**
- Product Hunt GraphQL: **전부 영어**

### 5.2 한국 사용자 관점 갭

| 갭 | 영향 | 개선안 |
|---|---|---|
| 국내 스타트업·빅테크 기술 블로그 부재 | 실무 적용 사례 부재 → 유저 체감도↓ | §3.6 추천 5~8종 즉시 투입 |
| 한국 AI 기업(업스테이지·솔트룩스·루닛·뤼튼·네이버 하이퍼클로바·카카오 KoGPT) 릴리스 추적 없음 | 한국어 LLM 이슈 사각 | 공식 블로그 RSS 탐색(없으면 스크레이프 옵션) |
| 한국어 YouTube 커버리지 4채널 한정 | 한국 바이브코더 영상 콘텐츠 부족 | DB화 후 10+ 채널로 확장 (안될공학, 노마드코더, 드림코딩, 조은현, 메타코드 등) |
| 한국 커뮤니티 미포함 (디스콰이엇·슬랙 공개방·Threads #바이브코딩) | 국내 사용자 목소리 없음 | RSSHub·스크레이프 기반 옵션 — Subtask C와 연계 |
| ZDNet Korea 전체 RSS → AI 비율 낮음 | 한국어 카테고리 노이즈 | AI/개발 섹션 RSS로 교체 |

### 5.3 언어 라벨링 이슈

- `youtube_source.ts:72` 채널 이름에 **한글 문자**가 있으면 `ko`, 그렇지 않으면 `en`. 안전하지만 한국어 자막만 있는 영문 채널 이름은 오분류 가능.
- `rss.ts:85` `宝玉 baoyu.io`에 `lang: "en"` 지정 — 실제 중·영 혼재. 한국어 유저 노출 시 이질감 가능성. `lang: "zh"` 또는 `"multi"` 도입 제안.
- `gdelt_source.ts:77` `article.language === "Korean"` → `ko`, 그 외 전부 `en` — **일본어/중국어도 `en`으로 라벨링** 버그 소지.

---

## 6. 도입 우선순위 로드맵

### 6.1 Phase 1 — 즉시(1주 내)

1. **제거**: HackerNews AI(hnrss), Product Hunt RSS, LogRocket, Phoronix — 4건.
2. **복구(시드에 있으나 코드 누락)**:
   - GitHub Releases에 Aider/LiteLLM/Open WebUI 추가.
   - RSS에 토스 기술 블로그, GeekNews Blog, The Batch, Import AI 추가.
3. **한국 채널 확장**: `youtube_source.ts` 하드코딩 리스트에 안될공학·노마드코더·드림코딩 추가(또는 DB화).
4. **언어 라벨 버그**: GDELT 비-영문/비-한글 라벨링 개선 계획 수립.

### 6.2 Phase 2 — 2~3주

1. 바이브코딩 에디터 Blog/Changelog 추가: Cursor Blog, Windsurf, Zed, Replit, v0.
2. AI 랩 1차 소스 추가: Meta AI, Mistral, DeepSeek, xAI.
3. Reddit 서브레딧 확장: r/SideProject, r/OpenAI, r/Singularity, r/ChatGPT, r/aipromptprogramming.
4. GitHub Trending RSS(비공식) + Show HN 추가.

### 6.3 Phase 3 — 1~2개월 (구조 개선)

1. **`rss.json` 시드 파일을 런타임 단일 출처로 전환**: `rss.ts`의 하드코딩 배열을 JSON 기반 설정으로 마이그레이션. `input_count`/`output_count`/`source_weights` 필드를 `scoring.ts`에 연결.
2. **Diversity quotas**: `rss.json:141-154` `diversity_quotas` 도입 — `Research≤3, Policy≤3, Korea≥2, VibeCoding≥1`.
3. **YouTube 채널 DB화**: `youtube_source.ts` 리스트를 `youtube_recommend_source.ts`처럼 DB 테이블로 이관.
4. **언어 지원 확장**: `ko/en` 외에 `zh/ja` 파이프라인 경로 검토(한국 일부 사용자 수요).
5. **SNS 통합**: X·Threads를 위한 RSSHub/serverless 수집 경로 도입(Subtask C 결정 후 구현).

---

## 7. 추가 관찰 사항 (기타 리스크)

- **`youtube_recommend_source.ts`는 랭킹 파이프라인과 분리**되어 DB에만 저장. 즉 `snapshot.ts`의 키워드 후보에는 기여하지 않음(`snapshot.ts:793-808`). 만약 한국 YouTube를 키워드 후보로 태우려면 `collectYoutubeItems` 경로를 거쳐야 함 — 현재 한국 채널은 그 쪽에만 4개 존재.
- **Changelog 스크레이프는 HTML 구조 변경에 취약**. OpenAI·Cursor·Warp 다 CSS selector 휴리스틱(`changelog_source.ts:24, 100`). 공식 RSS가 있으면 교체 권고.
- **Product Hunt RSS와 GraphQL의 이중 수집**: 중복 URL 필터(`snapshot.ts:822-827`)로 일부 차단되나 동일 제품 다른 URL 표기 가능 → GraphQL 단일화 권장.
- **GDELT `maxrecords=250` 단일 호출**(`gdelt_source.ts:47`): 영어 우세 쿼리로 한국어 기사 비중 매우 낮음. `sourcelang=kor` 파라미터 추가 또는 한국어 전용 호출 이중화 고려.
- **Reddit rate-limit 1초**(`reddit_source.ts:108-110`): 서브레딧 확장 시 전체 시간 증가 선형. Phase 2에서 서브레딧 15개로 확장 시 ~15초. Promise.all + 주의.
- **`_pipeline_reference/workflow/resources/rss.json`은 "참조용"**이지만 현재 코드 경로와 동기화되지 않아 **시드 드리프트** 상태. Phase 3에서 SSOT(Single Source of Truth) 승격 권고.
- **GitHub PAT 의존**: `github_source.ts:21`, `github_releases_source.ts:90`, `github_md_source.ts:64`가 모두 `GITHUB_TOKEN` 없으면 조기 반환. Secret 미설정 환경에서 카탈로그가 자동 축소됨을 상기.

---

## 8. 카테고리별 분포 — 현재 vs 목표

### 8.1 카테고리 정의(제안)

| 카테고리 | 정의 | 대표 소스 | 목표 쿼터 |
|---|---|---|---|
| Model | LLM/VLM 모델 릴리스·벤치마크 | OpenAI/Anthropic/Meta AI Blog, HF | 2~3 |
| Agent | 에이전틱·툴 유즈·MCP·auto coding | LangChain, CrewAI, AutoGen, OpenHands | 2~3 |
| VibeCoding | 에디터·코딩 보조·인디 프로덕트 | Cursor/Windsurf/Zed/Claude Code Blog, HN Show | 3~5 |
| DevTool | 개발 플랫폼·인프라 · Vercel·Supabase | Vercel, Sourcegraph, Supabase | 2~3 |
| Infra | GPU·inference·serving | NVIDIA, SemiAnalysis, vLLM release | 1~2 |
| Policy | 규제·정책·윤리 | The Verge AI, MIT Tech Review | 0~2 |
| Korea | 한국 기술 블로그·뉴스 | 토스/우형/카카오/네이버/GeekNews/Bloter | 2~4 |
| Research | 논문·학회 | HF Daily Papers, arXiv | 0~2 |
| Other | 분류 실패·기타 | — | — |

### 8.2 현재 분포(38 RSS 피드 기준, 추정)

| 카테고리 | 현재 피드 수 | 비중 | 적정성 |
|---|---|---|---|
| Model | 4 (OpenAI/Anthropic/HF/Google Research) | 10.5% | 양호 |
| Agent | 2 (LangChain/CrewAI releases) | 5.3% | **부족** |
| VibeCoding | 5 (Vercel, Sourcegraph, Sebastian, Dev.to Vibe, Latent Space) | 13.2% | 코어 대비 부족 |
| DevTool | 3 (GitHub, Changelog.com, LogRocket) | 7.9% | 노이즈 혼재 |
| Infra | 3 (NVIDIA, SemiAnalysis, Interconnects) | 7.9% | 양호 |
| Policy | 5 (MIT TR, TC AI, VB AI, Verge AI, Ars AI) | 13.2% | **과다** |
| Korea | 2 (GeekNews, ZDNet Korea) | 5.3% | **크게 부족** |
| Research | 3 (HF Daily, Towards AI, arXiv 없음) | 7.9% | arXiv 누락 |
| Mixed/Other | 11 | 28.9% | 분류 재검토 필요 |

### 8.3 목표 분포(Phase 3 완료 기준, 40~45 피드 가정)

| 카테고리 | 목표 피드 수 | 비중 |
|---|---|---|
| Model | 5~6 (OpenAI/Anthropic/Meta/Mistral/DeepSeek/HF) | ~13% |
| Agent | 4~5 (LangChain/LlamaIndex/CrewAI/AutoGen/OpenHands + MCP ecosystem) | ~11% |
| VibeCoding | 7~9 (Cursor/Windsurf/Zed/Replit/v0/Claude Code/Aider) | ~20% |
| DevTool | 4~5 (Vercel/Supabase/Sourcegraph/GitHub Blog) | ~11% |
| Infra | 2~3 (NVIDIA/SemiAnalysis/Interconnects) | ~7% |
| Policy | 2~3 (The Verge/MIT 선별) | ~6% |
| Korea | 6~8 (GeekNews/토스/우형/카카오/네이버/요즘IT/Bloter/ZDNet Korea AI) | **~18%** |
| Research | 2 (HF Daily + 선택적 arXiv 단일) | ~5% |

---

## 9. 바이브코딩 유저 동선 기반 시나리오 점검

### 9.1 페르소나 세 명

| 페르소나 | 특징 | 원하는 정보 |
|---|---|---|
| **주니어 바이브코더(만 25세, 한국, 에이전시 실무)** | Cursor + Claude 사용, 한국어 콘텐츠 선호 | 오늘 Cursor/Claude Code 신규 기능, 한국어 에이전트 튜토리얼, 인디 해커 수익 공개 |
| **시니어 AI 엔지니어(만 34세, 스타트업 CTO)** | vLLM·LangGraph·MCP 활용 | 모델 릴리스 성능 벤치, 프레임워크 버그, 규모 운영 사례 |
| **트렌드 민감 크리에이터(만 29세, 한국, YouTuber)** | 조회수 유발 소재 | 핫한 에디터 기능, 트위터 화제, 국내 AI 스타트업 이벤트 |

### 9.2 페르소나별 소스 커버리지 갭

| 페르소나 | 잘 커버 | 구멍 |
|---|---|---|
| 주니어 한국 바이브코더 | GeekNews, 한국 YouTube 4채널 | 토스·우형·카카오 블로그, 디스콰이엇, 요즘IT, Threads 검색 |
| 시니어 AI 엔지니어 | Simon Willison, Interconnects, vLLM releases, SemiAnalysis | LangGraph 변경, MCP 스펙 변화, MLPerf 결과 |
| 트렌드 크리에이터 | Product Hunt, Fireship, The AI Advantage | X/Threads 실시간 대화, GitHub Trending 급상승 |

### 9.3 현황에서 놓치는 "오늘의 바이브코딩" 이벤트 예시

- Cursor 1.5 신규 기능 공개 → **공식 RSS 누락** → Changelog 스크레이프 실패 시 **완전 누락** 가능.
- Zed 에이전트 패널 출시 → 현재 수집 경로 **0건**.
- 한국 "제미니 API 한국어 튜닝 사례"(토스 기술 블로그) → **완전 누락**.
- X에서 @amasad(Replit CEO) 주요 발표 → **SNS 미통합**.

---

## 10. `RSS_FEEDS` 리팩토링 / SSOT 마이그레이션 의사코드

### 10.1 `config/sources.yaml` (신규, Phase 3 제안)

```yaml
# 완전히 예시용입니다. 실제 구현은 팀 합의 후.
version: 2026-04-22
diversity_quotas:
  min:
    Model: 2
    Agent: 2
    VibeCoding: 3
    Korea: 2
  max:
    Research: 2
    Policy: 2

sources:
  - id: openai-blog
    title: "OpenAI Blog"
    kind: rss
    url: "https://openai.com/blog/rss.xml"
    tier: P0_CURATED
    category: Model
    lang: en

  - id: cursor-changelog
    title: "Cursor Changelog"
    kind: html_changelog
    url: "https://cursor.com/changelog"
    tier: P0_CURATED
    category: VibeCoding
    lang: en
    parser: cursor

  - id: toss-tech
    title: "토스 기술 블로그"
    kind: rss
    url: "https://toss.tech/rss.xml"
    tier: P0_CURATED
    category: Korea
    lang: ko

  - id: github-trending-daily
    title: "GitHub Trending (daily)"
    kind: rss
    url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml"
    tier: COMMUNITY
    category: VibeCoding
    lang: en
    quota_max: 5
    post_filter:
      min_stars_delta: 50
```

### 10.2 `loadSources()` 로더 스켈레톤

```typescript
// src/lib/pipeline/sources_loader.ts (신규 제안)
import { z } from "zod";
import { readFileSync } from "node:fs";
import yaml from "yaml";

const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["rss", "atom", "html_changelog", "graphql", "reddit", "youtube", "github_releases", "gdelt", "hn"]),
  url: z.string().url().optional(),
  tier: z.enum(["P0_CURATED", "P0_RELEASES", "P1_CONTEXT", "P2_RAW", "COMMUNITY"]),
  category: z.enum(["Model","Agent","VibeCoding","DevTool","Infra","Policy","Korea","Research","Other"]),
  lang: z.enum(["ko","en","zh","ja","multi"]),
  quota_max: z.number().int().positive().optional(),
  parser: z.string().optional(),
  post_filter: z.record(z.any()).optional(),
});

export type SourceConfig = z.infer<typeof SourceSchema>;

const ConfigSchema = z.object({
  version: z.string(),
  diversity_quotas: z.object({
    min: z.record(z.number().int().nonnegative()),
    max: z.record(z.number().int().positive()),
  }),
  sources: z.array(SourceSchema),
});

export function loadSources(path = "config/sources.yaml") {
  const raw = yaml.parse(readFileSync(path, "utf8"));
  return ConfigSchema.parse(raw);
}
```

### 10.3 `snapshot.ts` `SOURCE_PLANS` 대체 스케치

```typescript
// Phase 3: 하드코딩 대신 config 기반
const plans: SourcePlan[] = config.sources.map((s) => ({
  key: s.id,
  category: s.category,
  collect: (windowHours) => dispatchCollector(s, windowHours),
}));

function dispatchCollector(s: SourceConfig, windowHours: number) {
  switch (s.kind) {
    case "rss":
    case "atom": return collectRssItems(windowHours, [{ url: s.url!, title: s.title, tier: s.tier, lang: s.lang }]);
    case "html_changelog": return collectChangelogItems(windowHours); // 개별 config 주입으로 리팩토링
    case "github_releases": return collectGithubReleaseItems(windowHours);
    case "reddit": return collectRedditItems(windowHours);
    case "gdelt": return collectGdeltItems(windowHours);
    case "hn": return collectHnItems(windowHours);
    case "youtube": return collectYoutubeItems(windowHours);
    default: return Promise.resolve([]);
  }
}
```

### 10.4 Diversity Quota 적용 의사코드 (Subtask B와 접점)

```typescript
// 키워드 후보 상위 N개 선정 후, 카테고리 분포를 강제
function enforceDiversity(
  ranked: RankedKeyword[],
  sourceCategoryMap: Map<string, Category>,
  quotas: { min: Record<Category, number>; max: Record<Category, number> }
): RankedKeyword[] {
  const byCategory = new Map<Category, RankedKeyword[]>();
  for (const item of ranked) {
    const primaryCat = pickPrimaryCategory(item, sourceCategoryMap);
    (byCategory.get(primaryCat) ?? byCategory.set(primaryCat, []).get(primaryCat)!).push(item);
  }
  const final: RankedKeyword[] = [];
  // 1) min 쿼터 우선 충족
  for (const [cat, min] of Object.entries(quotas.min)) {
    for (const it of (byCategory.get(cat as Category) ?? []).slice(0, min)) {
      final.push(it);
    }
  }
  // 2) max 쿼터 내에서 남은 자리 채움
  // 3) 미해결 쿼터는 탑 점수로 보충
  return dedupe(final);
}
```

---

## 11. 제거·추가 diff 스니펫 (Phase 1 즉시 적용 초안)

### 11.1 `src/lib/pipeline/rss.ts` 수정 예시 (실제 코드 변경 금지 — 참고용)

```diff
   // ── P1_CONTEXT: 개발자 도구 전문 매체 ─────────────────────────────────────
   { url: "https://lobste.rs/rss", title: "Lobsters", tier: "P1_CONTEXT", lang: "en" },
   { url: "https://changelog.com/feed", title: "Changelog", tier: "P1_CONTEXT", lang: "en" },
-  { url: "https://blog.logrocket.com/feed/", title: "LogRocket Blog", tier: "P1_CONTEXT", lang: "en" },
-  { url: "https://www.phoronix.com/rss.php", title: "Phoronix", tier: "P1_CONTEXT", lang: "en" },
-  { url: "https://www.producthunt.com/feed", title: "Product Hunt", tier: "P1_CONTEXT", lang: "en" },
+  // LogRocket·Phoronix 제거(마케팅/비AI 노이즈). Product Hunt는 GraphQL 경로 단일화.
+
+  // ── P0_CURATED 추가: 바이브코딩 에디터 & 한국 블로그 ──────────────────────
+  { url: "https://zed.dev/blog.rss", title: "Zed Blog", tier: "P0_CURATED", lang: "en" },
+  { url: "https://blog.replit.com/rss", title: "Replit Blog", tier: "P0_CURATED", lang: "en" },
+  { url: "https://vercel.com/changelog/rss.xml", title: "Vercel Changelog", tier: "P0_CURATED", lang: "en" },
+  { url: "https://toss.tech/rss.xml", title: "토스 기술 블로그", tier: "P0_CURATED", lang: "ko" },
+  { url: "https://news.hada.io/rss/blog", title: "GeekNews Blog", tier: "P0_CURATED", lang: "ko" },
+  { url: "https://techblog.woowahan.com/feed/", title: "우아한형제들 기술블로그", tier: "P0_CURATED", lang: "ko" },

   // ── COMMUNITY ─────────────────────────────────────────────────────────────
-  { url: "https://hnrss.org/newest?q=LLM+AI", title: "HackerNews AI", tier: "COMMUNITY", lang: "en" },
+  // HackerNews AI(hnrss) 제거: hn_source.ts와 중복.
+  { url: "https://hnrss.org/show?points=30", title: "Show HN (AI/Dev)", tier: "COMMUNITY", lang: "en" },
+  { url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", title: "GitHub Trending", tier: "COMMUNITY", lang: "en" },
```

### 11.2 `src/lib/pipeline/github_releases_source.ts` 수정 예시

```diff
 const TRACKED_REPOS: string[] = [
   "ollama/ollama",
   "langchain-ai/langchain",
+  "langchain-ai/langgraph",
   "crewAIInc/crewAI",
   "microsoft/autogen",
   "run-llama/llama_index",
   "vllm-project/vllm",
   "huggingface/transformers",
   "ggml-org/llama.cpp",
   "LadybirdBrowser/ladybird",
   "anthropics/claude-code",
   "vercel/ai",
   "openai/openai-python",
   "google/generative-ai-python",
   "All-Hands-AI/OpenHands",
   "continuedev/continue",
+  "Aider-AI/aider",
+  "BerriAI/litellm",
+  "open-webui/open-webui",
 ];
```

### 11.3 `src/lib/pipeline/reddit_source.ts` 수정 예시

```diff
 const SUBREDDITS = [
   "MachineLearning",
   "artificial",
   "LocalLLaMA",
   "vibecoding",
   "PromptEngineering",
   "cursor",
   "ClaudeAI",
   "ChatGPTCoding",
   "ollama",
+  "SideProject",
+  "OpenAI",
+  "aipromptprogramming",
+  "IndieHacking",
 ];
```

### 11.4 `src/lib/pipeline/youtube_source.ts` 한국 채널 확장 예시

```diff
   // ── 한국어 AI 개발 ────────────────────────────────────────────────────────
   { channelId: "UCt2wAAXgm87ACiQnDHQEW6Q", name: "테디노트 TeddyNote" },
   { channelId: "UCQNE2JmbasNYbjGAcuBiRRg", name: "조코딩 JoCoding" },
   { channelId: "UCxj3eVTAv9KLdrowXcuCFDQ", name: "빌더 조쉬 Builder Josh" },
   { channelId: "UCxZ2AlaT0hOmxzZVbF_j_Sw", name: "코드팩토리" },
+  { channelId: "UC7SRtKaZYrSSvhZBPS7A1fQ", name: "안될공학" }, // 채널 ID 확인 필요
+  { channelId: "UCaTznQhurW5AaiYPbhEA-KA", name: "노마드코더" },
+  { channelId: "UCDv98NXHLyTPOh3pxXVcbSg", name: "드림코딩" },
```

---

## 12. 소스 헬스체크·모니터링 권고

### 12.1 현재 모니터링 수준

- `sources.ts`류: `console.log`/`console.warn`만. 구조화 로깅·알림 없음.
- `upsertSourceIngestionState`(`snapshot.ts:355-363`): 성공 시점·아이템 수·윈도우는 기록하지만 **실패 연속 횟수·에러 지연 시간**은 추적하지 않음.
- `rss_feeds.test.ts`: 피드 존재 여부만 확인. **실제 네트워크 페치·HTTP 상태 회귀** 검증 없음.

### 12.2 개선 권고

| 항목 | 권고 |
|---|---|
| Feed health | `source_health` 테이블에 `consecutive_failures`, `last_success_at`, `last_http_status` 적재 → 일정 임계(≥5 연속 실패) 시 자동 비활성 |
| 지연 경보 | `last_published_at_utc`가 feed_expected_interval 2배 이상 지연 시 Slack/Discord 통지 (`sourceStates` 확장) |
| 콘텐츠 검증 | 피드당 주 1회 스팟 샘플을 LLM에 태깅(주제/노이즈율) — 7일 이동평균으로 tier 자동 강등 후보 자동 추출 |
| 스모크 테스트 | CI에 `npm run test:feeds-smoke` 추가 — 주요 피드 HTTP 200 + 최근 30일 내 1건 이상 |
| 라벨 검증 | `lang` 필드 자동 검증 — 피드 상위 10개 제목 LLM 언어 분류와 설정 `lang` 일치율 <80% 시 경고 |

### 12.3 예시 SQL 스키마 (추가 제안)

```sql
CREATE TABLE IF NOT EXISTS source_health (
  source_key TEXT PRIMARY KEY,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_success_at_utc TIMESTAMPTZ,
  last_failure_at_utc TIMESTAMPTZ,
  last_http_status INT,
  last_item_count INT,
  last_window_hours INT,
  disabled_until TIMESTAMPTZ,
  notes TEXT
);
```

---

## 13. 리스크·제약 정리

| 리스크 | 설명 | 완화책 |
|---|---|---|
| 서드파티 RSS 프록시(RSSHub, nitter) 변동 | X/Threads 수집 경로 안정성↓ | 자체 호스팅 인스턴스 또는 ToS 합법 API 대체 |
| 스크레이프 소스 HTML 변경 | Cursor/Warp Changelog 파서 깨짐 | 공식 RSS 교체, 변경 감시 테스트 |
| GitHub PAT 만료·레이트리밋 | 3개 경로 동시 중단 | 전용 Service Account + rotation |
| 카테고리 분류 편향 | 카테고리 필터링 튜닝 부족으로 Korea 저조 지속 | Phase 3 `sources.yaml`에서 `category` 강제 + 쿼터 |
| 매체 TOS | ZDNet/전자신문 차단 이력 | User-Agent 정책 명시, 필요시 정식 허가 요청 |
| 중복 수집 비용 | Product Hunt RSS+GraphQL 동시 실행 시 GraphQL rate-limit 소진 | Phase 1에서 RSS 제거 |
| 한국어 라벨 오검출 | `baoyu.io` 및 다언어 소스 | Phase 3 `lang: multi` 도입 |

---

## 14. 참고 — 추천 YouTube 채널 10선 (영상 수집 경로 확장용)

| # | 채널 | 대상 페르소나 | 언어 |
|---|---|---|---|
| 1 | 안될공학 | 주니어 한국 바이브코더 | ko |
| 2 | 노마드코더 | 주니어·초급 | ko |
| 3 | 드림코딩 by 엘리 | 주니어 | ko |
| 4 | 메타코드M | 주니어·데이터 | ko |
| 5 | 생활코딩 | 일반 | ko |
| 6 | AI Jason | 엔지니어 | en |
| 7 | David Ondrej | 프로덕트 | en |
| 8 | Greg Isenberg | 인디 해커 | en |
| 9 | All About AI | 실전 | en |
| 10 | Yannic Kilcher | 리서치 | en |

> ※ 채널 ID는 실제 도입 전 `yt-dlp --get-url` 또는 YouTube Data API로 확정 필요.

---

## 15. 근거 인용 (file:line)

### 8.1 현재 코드 기준

- `web-server/src/lib/pipeline/rss.ts:39` — `RSS_FEEDS` 배열 시작.
- `web-server/src/lib/pipeline/rss.ts:41-96` — 38개 피드 항목.
- `web-server/src/lib/pipeline/rss.ts:88-89` — AI타임스·전자신문 제거 주석.
- `web-server/src/lib/pipeline/rss_feeds.test.ts:14-91` — 피드 존재 여부 회귀 테스트.
- `web-server/src/lib/pipeline/gdelt_source.ts:31-87` — GDELT 수집, `tier: "P1_CONTEXT"` 하드코딩, `lang` 이분법.
- `web-server/src/lib/pipeline/hn_source.ts:34-84` — front_page + dynamic query 이중 수집.
- `web-server/src/lib/pipeline/youtube_source.ts:11-34` — 채널 19개 하드코딩.
- `web-server/src/lib/pipeline/youtube_source.ts:70-73` — 한글 감지로 `lang` 결정.
- `web-server/src/lib/pipeline/youtube_recommend_source.ts:86-99` — DB 테이블 저장(랭킹 비연결).
- `web-server/src/lib/pipeline/changelog_source.ts:134-170` — 5 Changelog 소스.
- `web-server/src/lib/pipeline/github_source.ts:17-77` — GitHub Search dynamic query.
- `web-server/src/lib/pipeline/github_releases_source.ts:5-21` — 15 추적 리포.
- `web-server/src/lib/pipeline/github_md_source.ts:3-7` — `GENEXIS-AI/DailyNews` 폴더, 스킵 도메인 X/Threads/t.co.
- `web-server/src/lib/pipeline/product_hunt_top_source.ts:153-248` — GraphQL AI/Dev 필터.
- `web-server/src/lib/pipeline/reddit_source.ts:3-13` — 9 서브레딧.
- `web-server/src/lib/pipeline/snapshot.ts:142-153` — `SOURCE_PLANS` 10개 플랜.
- `web-server/src/lib/pipeline/snapshot.ts:793-827` — 전체 소스 병렬 수집 + URL 중복 제거.
- `web-server/src/lib/pipeline/source_category.ts:10-91` — 소셜/데이터/뉴스 분류 도메인 세트.

### 8.2 과거 시드 (드리프트 확인)

- `_pipeline_reference/workflow/resources/rss.json:166-279` — P0_CURATED 12개(현재 9개만 반영).
- `_pipeline_reference/workflow/resources/rss.json:286-299` — P0_RELEASES 13개(현재 15개, 3개 누락 항목 존재).
- `_pipeline_reference/workflow/resources/rss.json:141-154` — `diversity_quotas`(현재 미적용).
- `_pipeline_reference/workflow/resources/rss.json:156-162` — `source_weights`(현재 `scoring.ts` 가중치와 정합 필요).
- `_pipeline_reference/workflow/resources/rss.json:306-317` — 뉴스레터 11종(현재 일부만 반영).

---

## 16. 미해결 질문 (Open Questions)

1. **RSSHub 의존 허용 범위?** — X/Threads/IH 같은 서드파티 프록시 기반 소스를 운영 환경에서 허용할지(가용성·법적 이슈). 자체 프록시 구축 여부. (→ Subtask C 결정사항과 정합 필요)
2. **`rss.json` SSOT 승격 여부** — 현재 하드코딩된 `rss.ts`와 JSON 시드의 이원화를 어느 시점에 통합할지. 마이그레이션 시 테스트 파일(`rss_feeds.test.ts`) 재설계 계획이 필요.
3. **YouTube 채널 DB화** — `youtube_recommend_source.ts`처럼 `youtube_source.ts`도 DB화 시, 관리 UI(추가/제거/우선순위)와 권한 모델.
4. **한국어 언론사 TOS** — 매일경제/조선/전자신문 AI 섹션을 재시도할지. WAF 차단 회피 권장 방법(User-Agent 교체 vs 공식 허가).
5. **"바이브코딩" 정의의 경계** — 추천 소스 중 r/SideProject·Indie Hackers처럼 "제품 런칭" 위주 소스의 포함 기준. 유저 프로파일 수집 없이 결정 가능한가?
6. **공식 RSS 부재 소스의 스크레이프 허용 여부** — Cursor/Windsurf/Zed Blog는 정적 SSG이므로 HTML 스크레이프가 안정적. 법적/ToS 검토 필요.
7. **언어 혼합 소스 라벨 정책** — `baoyu.io`, GDELT 비-영문 라벨, 멀티언어 YouTube 채널에 대한 `lang` 스키마 확장(`ko|en|zh|ja|multi`).
8. **GDELT 대체제** — GDELT 대신 News API, Event Registry, MediaStack 같은 상용 API 대체 검토. 비용·정확도 트레이드오프.
9. **GitHub Search 스팸 방지** — `github_source.ts`가 스타 0~수십 개 신규 레포까지 포함. 바이브코드 저품질 레포 제외를 위한 `stars:>20 forks:>5` 같은 조건 추가 검토.
10. **Diversity Quota 도입 시점** — `rss.json:141-154`의 카테고리별 최소/최대 쿼터를 Subtask B 신 모델에 어떻게 녹일지.

---

11. **Changelog 스크레이프 실패 모드** — `changelog_source.ts`의 휴리스틱 CSS selector가 OpenAI/Cursor 둘 중 어느 쪽이 먼저 깨질 가능성이 높은가? 모니터링 지표를 무엇으로 삼을지(파싱 건수 0 연속 3회 등) 합의 필요.
12. **한국 Reddit/Threads 대체** — 한국에는 Reddit 활성도가 낮음. 디스콰이엇·GeekNews 댓글·OKKY·Threads KR 해시태그 등 어떤 대체 풀을 공식 수집원으로 인정할지.
13. **키워드 소스 가중치의 지역 편향 보정** — 미국 중심 피드가 다수이므로 한국어 피드 1건이 키워드 랭킹에 진입하려면 현재 가중치에서 불리. `source_weights`에 `lang=ko` bonus를 주는 게 정책적으로 정당한가?
14. **Release Radar 경계** — 어떤 리포를 P0_RELEASES에 편입할지 기준(스타 수, 다운로드, 바이브코더 사용률)을 객관화할 수 있는가? 지금은 수동 리스트.
15. **수집 빈도의 실제 KST 스케줄** — `.github/workflows/cron_realtime.yml` 05/11/17/23 KST 4회. 릴리스 집중 시간대(美 PT 오전)와 어긋남. 슬롯 추가 또는 webhook 기반 push 수집 필요성?

---

## 17. 부록 — 현재 수집 경로 총람 (원-페이지 요약)

| 경로 | 구현 파일 | 수집 방식 | 기본 윈도우 | 인증 | 분류 영향 |
|---|---|---|---|---|---|
| RSS/Atom | `src/lib/pipeline/rss.ts` | `rss-parser` 병렬 fetch | `windowHours` env | 없음 | tier/lang |
| HackerNews | `src/lib/pipeline/hn_source.ts` | Algolia API (front_page + dynamic) | 72h | 없음 | COMMUNITY/P1 |
| GDELT | `src/lib/pipeline/gdelt_source.ts` | GDELT Doc v2 API | 72h | 없음 | P1 |
| GitHub Search | `src/lib/pipeline/github_source.ts` | REST Search API | 72h | **GITHUB_TOKEN** | COMMUNITY |
| GitHub Releases | `src/lib/pipeline/github_releases_source.ts` | REST repos/releases | 72h | **GITHUB_TOKEN** | P1 |
| GitHub MD | `src/lib/pipeline/github_md_source.ts` | repo contents + markdown 파싱 | 72h | 선택 | P0 ko |
| YouTube | `src/lib/pipeline/youtube_source.ts` | 채널 RSS × 19 | 72h | 없음 | COMMUNITY |
| YouTube Recommend | `src/lib/pipeline/youtube_recommend_source.ts` | DB 기반 채널 목록 → RSS → DB 저장 | 72h | 없음 | (별도 테이블) |
| Changelog | `src/lib/pipeline/changelog_source.ts` | HTML 스크레이프 × 5 | 72h | 없음 | P0/P1 |
| Product Hunt | `src/lib/pipeline/product_hunt_top_source.ts` | GraphQL | 48h↑ | **PRODUCT_HUNT_TOKEN** | P1 + ranking signal |
| Reddit | `src/lib/pipeline/reddit_source.ts` | JSON (hot+rising) × 9 | 72h | 없음 | COMMUNITY |

### 17.1 카테고리 친화도 매트릭스 (요약)

| 경로 | Model | Agent | VibeCoding | DevTool | Infra | Policy | Korea | Research |
|---|---|---|---|---|---|---|---|---|
| RSS P0_CURATED | ●●● | ● | ● | ●● | ● | ●● | ● | ●● |
| RSS P1_CONTEXT | ●● | ●● | ●● | ●●● | ●●● | ●●● | ● | ● |
| RSS COMMUNITY | ● | ●● | ●● | ●● | ● | ● | — | ● |
| GDELT | ● | — | — | ● | — | ●●● | ● | — |
| HN | ●● | ●● | ●●● | ●●● | ●● | ● | — | ● |
| YouTube | ●● | ●● | ●●● | ●● | — | ● | ●● | — |
| Changelog | ●●● | ● | ●●● | ●● | — | — | — | — |
| GitHub Search/Rel | ● | ●●● | ●● | ●● | ●●● | — | — | — |
| GitHub MD | ●● | ● | ● | ● | — | ● | ●●● | — |
| Product Hunt | ● | ●● | ●●● | ●●● | — | — | — | — |
| Reddit | ●● | ●● | ●●● | ●● | ● | — | — | ● |

(●의 개수가 많을수록 해당 카테고리에 대한 친화도가 높음. ●●● = 주력, — = 거의 무관)

---

_end of Subtask A report._
