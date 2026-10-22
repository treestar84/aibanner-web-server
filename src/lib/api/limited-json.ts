import { readLimitedBody } from "../safe-fetch";
// Fits 20 existing 8,000-character stacks even with JSON Unicode escaping.
export async function limitedJson(
  req: Request,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  const body = await readLimitedBody(req, maxBytes);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}
