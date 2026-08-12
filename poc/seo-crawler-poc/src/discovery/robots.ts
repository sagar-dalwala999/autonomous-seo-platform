/** Slice S3 implements. */
import robotsParser from "robots-parser";
import type { RobotsInfo } from "../models/types";
import { fetchWithTimeout, resolveAbsolute } from "./http";

/**
 * Fetch + parse <origin>/robots.txt. Never throws: 404/unreachable → allow-all with
 * parseStatus "unavailable"/"error" recorded as evidence.
 */
export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsInfo> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const fetchedAt = new Date().toISOString();

  let res: Response;
  try {
    res = await fetchWithTimeout(robotsUrl, { headers: { "user-agent": userAgent } });
  } catch {
    return allowAll(robotsUrl, null, "error", fetchedAt);
  }

  if (res.status !== 200) {
    return allowAll(robotsUrl, res.status, "unavailable", fetchedAt);
  }

  const content = await res.text();
  const parser = robotsParser(robotsUrl, content);
  const sitemaps = parser
    .getSitemaps()
    .map((raw) => resolveAbsolute(raw, origin))
    .filter((s): s is string => s !== null);

  return {
    url: robotsUrl,
    statusCode: res.status,
    content,
    sitemaps,
    parseStatus: content.trim().length === 0 ? "empty" : "ok",
    fetchedAt,
    isAllowed(target: string, ua: string = userAgent): boolean {
      // robots-parser returns undefined for URLs it can't match (e.g. host mismatch) — treat as
      // allowed rather than block on ambiguity; evidence collection over-blocks otherwise.
      return parser.isAllowed(target, ua) !== false;
    },
  };
}

function allowAll(
  url: string,
  statusCode: number | null,
  parseStatus: "unavailable" | "error",
  fetchedAt: string
): RobotsInfo {
  return {
    url,
    statusCode,
    content: null,
    sitemaps: [],
    parseStatus,
    fetchedAt,
    isAllowed: () => true,
  };
}
