// MCP 툴 description 상수 — 영문 + 서비스명(Vibenow(바이브나우)) 병기.
// route.ts에서 import하고, tools.test.ts에서 동일 상수를 검증한다.
// docs/mcp-playmcp-compliance-design.md 작업 2 참고.

export const DESC_GET_REALTIME_TRENDS =
  'Retrieves the current real-time trending AI keyword rankings from Vibenow(바이브나우), refreshed 4 times daily from 16 collection routes including news, communities, GitHub, and YouTube. Returns rank, rank delta, an AI-generated one-line summary, and a source link for each keyword. Use for questions like "What\'s trending in AI right now?" or "지금 AI 업계에서 뭐가 화제야?".';

export const DESC_GET_BURNING_KEYWORDS =
  'Retrieves rapidly rising (burning) AI keywords ranked by user view momentum from Vibenow(바이브나우). Use when asked about suddenly surging or spiking AI topics, e.g. "Which AI keywords are suddenly hot?" or "갑자기 뜨는 AI 키워드 알려줘".';

export const DESC_GET_KEYWORD_DETAIL =
  'Retrieves a detailed explanation of why a specific AI keyword is trending right now from Vibenow(바이브나우), including an AI-generated summary, hashtags, and categorized source links (news/community/data). Use when the user asks about one specific keyword, e.g. "Why is {keyword} trending?" or "{키워드}가 왜 떠?".';

export const DESC_SEARCH_TRENDS =
  "Searches past and present AI trend keywords collected by Vibenow(바이브나우). Use when a keyword the user asked about is not in the current real-time ranking, or to look up historical trend keywords.";

export const DESC_GET_HOT_TOPICS =
  'Retrieves today\'s AI hot topic briefings from Vibenow(바이브나우). Each topic is synthesized from multiple independent sources with attribution links. Use for requests like "Summarize today\'s AI news" or "오늘 AI 핫토픽 정리해줘".';

export const DESC_GET_DAILY_PODCAST =
  'Retrieves today\'s auto-generated Korean AI news podcast from Vibenow(바이브나우) — a two-host talk show audio program covering the day\'s AI topics. Returns the episode title, description, duration, and a streamable audio URL. Present the audio URL to the user as a playable link. Use for "Play today\'s AI news podcast" or "오늘 AI 뉴스 팟캐스트 들려줘".';
