import type { PipelineMode } from "@/lib/pipeline/mode";

export interface ManualKeywordNoticeItem {
  keyword: string;
  mode: PipelineMode;
  expires_at: string;
}

export type ManualKeywordOnDemandSnapshot =
  | {
      ok: true;
      mode: PipelineMode;
      snapshotId: string;
      keywordCount: number;
      reusedCount: number;
    }
  | {
      ok: false;
      mode: PipelineMode;
      error: string;
    };

export type ManualKeywordFeedbackTone = "success" | "warning";

export interface ManualKeywordFeedback {
  tone: ManualKeywordFeedbackTone;
  message: string;
}

function formatNoticeKst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function snapshotTail(snapshot?: ManualKeywordOnDemandSnapshot): {
  tone: ManualKeywordFeedbackTone;
  text: string;
} {
  if (!snapshot) {
    return { tone: "success", text: "즉시 반영 스냅샷 정보 없음" };
  }
  if (snapshot.ok) {
    return {
      tone: "success",
      text: `스냅샷 ${snapshot.snapshotId} 즉시 반영`,
    };
  }
  return {
    tone: "warning",
    text: `스냅샷 즉시 반영 실패 · ${snapshot.error}`,
  };
}

export function buildManualKeywordFeedback(input: {
  action: "create" | "extend" | "enable" | "disable" | "delete";
  item?: ManualKeywordNoticeItem;
  previousItem?: ManualKeywordNoticeItem;
  deletedKeyword?: string;
  ttlHours?: number;
  snapshot?: ManualKeywordOnDemandSnapshot;
}): ManualKeywordFeedback {
  const snapshot = snapshotTail(input.snapshot);
  const item = input.item;
  const previousItem = input.previousItem;

  if (input.action === "delete") {
    const keyword = input.deletedKeyword?.trim() || "키워드";
    return {
      tone: snapshot.tone,
      message: `${keyword} 삭제 완료 · 공개 목록에서 즉시 제외 · ${snapshot.text}`,
    };
  }

  if (!item) {
    return {
      tone: snapshot.tone,
      message: `작업 완료 · ${snapshot.text}`,
    };
  }

  if (input.action === "create") {
    return {
      tone: snapshot.tone,
      message:
        `${item.keyword} 등록 완료 · mode=${item.mode} · 만료 ${formatNoticeKst(item.expires_at)} · ${snapshot.text}`,
    };
  }

  if (input.action === "extend") {
    const ttlText = input.ttlHours ? `+${input.ttlHours}시간` : "연장";
    const expiryText = previousItem
      ? `${formatNoticeKst(previousItem.expires_at)} -> ${formatNoticeKst(item.expires_at)}`
      : `새 만료 ${formatNoticeKst(item.expires_at)}`;
    return {
      tone: snapshot.tone,
      message: `${item.keyword} ${ttlText} 연장 완료 · ${expiryText} · ${snapshot.text}`,
    };
  }

  if (input.action === "enable") {
    const expiryChanged =
      !!previousItem && previousItem.expires_at !== item.expires_at;
    const expiryText = expiryChanged
      ? `새 만료 ${formatNoticeKst(item.expires_at)}`
      : `기존 만료 유지 ${formatNoticeKst(item.expires_at)}`;
    return {
      tone: snapshot.tone,
      message: `${item.keyword} 재활성화 완료 · ${expiryText} · ${snapshot.text}`,
    };
  }

  return {
    tone: snapshot.tone,
    message: `${item.keyword} 비활성화 완료 · 공개 목록에서 즉시 제외 · ${snapshot.text}`,
  };
}
