import type { PipelineMode } from "./mode";

export interface ScheduleSlot {
  hour: number;
  minute: number;
}

const MINUTES_PER_DAY = 24 * 60;
const KST_OFFSET_MINUTES = 9 * 60;
const DEFAULT_BRIEFING_SCHEDULE_UTC = "0:17,9:17";
const DEFAULT_REALTIME_SCHEDULE_UTC = "2:0,8:0,14:0,20:0";

export function defaultScheduleUtcForMode(mode: PipelineMode): string {
  return mode === "realtime"
    ? DEFAULT_REALTIME_SCHEDULE_UTC
    : DEFAULT_BRIEFING_SCHEDULE_UTC;
}

export function parseScheduleUtc(
  value: string | undefined,
  fallbackRaw: string
): ScheduleSlot[] {
  const raw = value?.trim() || fallbackRaw;
  const slots = raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [hourText, minuteText = "0"] = chunk.split(":");
      const hour = Number.parseInt(hourText, 10);
      const minute = Number.parseInt(minuteText, 10);
      if (
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        return null;
      }
      return { hour, minute };
    })
    .filter((slot): slot is ScheduleSlot => slot !== null)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  if (slots.length === 0) {
    return parseScheduleUtc(undefined, fallbackRaw);
  }

  return slots.filter((slot, index) => {
    if (index === 0) return true;
    const prev = slots[index - 1];
    return prev.hour !== slot.hour || prev.minute !== slot.minute;
  });
}

export function resolveScheduleUtc(mode: PipelineMode): ScheduleSlot[] {
  const fallbackRaw = defaultScheduleUtcForMode(mode);
  const configuredValue =
    mode === "realtime"
      ? process.env.PIPELINE_REALTIME_SCHEDULE_UTC
      : process.env.PIPELINE_BRIEFING_SCHEDULE_UTC ??
        process.env.PIPELINE_SCHEDULE_UTC;

  return parseScheduleUtc(configuredValue, fallbackRaw);
}

export function scheduleUtcToKstStrings(scheduleUtc: ScheduleSlot[]): string[] {
  const uniqueSortedMinutes = Array.from(
    new Set(
      scheduleUtc.map(
        (slot) =>
          (slot.hour * 60 + slot.minute + KST_OFFSET_MINUTES) % MINUTES_PER_DAY
      )
    )
  ).sort((a, b) => a - b);

  return uniqueSortedMinutes.map((totalMinutes) => {
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
}

export function scheduleKstForMode(mode: PipelineMode): string[] {
  return scheduleUtcToKstStrings(resolveScheduleUtc(mode));
}
