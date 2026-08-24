const MAX_IDS = 20;

export function normalizeExpertPickIds(ids: unknown[]): number[] {
  return [
    ...new Set(
      ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0),
    ),
  ].slice(0, MAX_IDS);
}
