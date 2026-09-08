import { authorKeyFor } from "./author-key";

export type CommunityPostRow = Record<string, unknown> & {
  author_device_id?: string | null;
};

export function mapCommunityPost(
  row: CommunityPostRow,
): Record<string, unknown> & { author_key: string | null } {
  const { author_device_id, ...post } = row;
  return {
    ...post,
    author_key: authorKeyFor(author_device_id),
  };
}

export function parsePositivePostId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null;
}
