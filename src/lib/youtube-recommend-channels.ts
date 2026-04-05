export interface DefaultYoutubeRecommendChannel {
  channelId: string;
  name: string;
  handle: string;
}

export const DEFAULT_YOUTUBE_RECOMMEND_CHANNELS: DefaultYoutubeRecommendChannel[] = [
  { channelId: "UCQNE2JmbasNYbjGAcuBiRRg", name: "조코딩 JoCoding", handle: "@JoCoding" },
  { channelId: "UCxj3eVTAv9KLdrowXcuCFDQ", name: "빌더 조쉬 Builder Josh", handle: "@builderJosh" },
  { channelId: "UCxZ2AlaT0hOmxzZVbF_j_Sw", name: "코드팩토리", handle: "@codefactory" },
  { channelId: "UC6xro-nRXlpa4A5UoeFKUDA", name: "커서맛피아", handle: "@cursormafia" },
  { channelId: "UCztt42h03X49HFRGW9--Bhg", name: "AI 보좌관", handle: "@aiadjunct" },
  { channelId: "UCLR3sD0KB_dWpvcsrLP0aUg", name: "오늘코드", handle: "@todaycode" },
  { channelId: "UCGU_CgteEqNSjiXcF0QfaKg", name: "데이터팝콘", handle: "@data.popcorn" },
  { channelId: "UCifUR1eEHhhXxK_Q_XoArPQ", name: "큐제이씨", handle: "@qjc_qjc" },
  { channelId: "UC86HxrAQ4GS1Iq8LIvUYigQ", name: "소스놀이터", handle: "@sourcePlayground" },
  { channelId: "UCZ4mb62ECiTMw8DcbBcMLmA", name: "엔드플랜", handle: "@ENDPLAN" },
  { channelId: "UCA6KbBMswPWk6sMTVxDa5xg", name: "텐빌더", handle: "@ten-builder" },
  { channelId: "UC6VbqOLKkdDhdtnhuTYPKxA", name: "SV 개발자", handle: "@sv.developer" },
  { channelId: "UCZ30aWiMw5C8mGcESlAGQbA", name: "짐코딩", handle: "@gymcoding" },
  { channelId: "UCeN2YeJcBCRJoXgzF_OU3qw", name: "언리얼테크", handle: "@unrealtech" },
  { channelId: "UCFmYIak2sRBXt2M3ep6U3QA", name: "제이초이", handle: "@jayychoii" },
  { channelId: "UC0WxGJnTB_04ViIrxPvFRmg", name: "메이커에반", handle: "@maker-evan" },
  { channelId: "UC1_ZZYZsHh2_DzCXN4VGVcQ", name: "개발동생", handle: "@개발동생" },
  { channelId: "UCqeurGTkc3KXeEcBO4S_Jyw", name: "코난쌤 conanssam", handle: "@conanssam" },
  { channelId: "UCSHbj8-YcdasMzqRzn_mHGA", name: "아이티커넥트", handle: "@itconnect_dev" },
  { channelId: "UCScI4bsr-RaGdYSC2QAHWug", name: "하울 바이브 코딩", handle: "@howl_vibe" },
  { channelId: "UCDLlMjELbrJdETmSiAB68AA", name: "시민개발자 구씨", handle: "@citizendev9c" },
  { channelId: "UCSOYuo3uOG3GCUFIeB4or7A", name: "AISchool", handle: "@aischool_ai" },
  { channelId: "UCqJNohiUt7qgGpKQh0O5yrQ", name: "잇다방 ITdabang", handle: "@itdabang" },
  { channelId: "UCouEEn-xhyTN9K6wSXjBbVQ", name: "AI싱크클럽", handle: "@AISyncClub" },
  { channelId: "UCfZCgp-n4yLLEaX6E30Xh4w", name: "대모산 개발단", handle: "@대모산개발단" },
  { channelId: "UCXKXULkq--aSgzScYeLYJog", name: "단테랩스", handle: "@dante-labs" },
];

export function buildYoutubeChannelUrl(channelId: string, handle?: string): string {
  const normalizedHandle = (handle ?? "").trim();
  if (normalizedHandle.startsWith("@")) {
    return `https://www.youtube.com/${normalizedHandle}`;
  }
  return `https://www.youtube.com/channel/${channelId.trim()}`;
}
