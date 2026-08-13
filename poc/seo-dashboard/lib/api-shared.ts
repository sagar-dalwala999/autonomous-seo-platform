/**
 * Client-safe-ish (no node:fs) helpers shared by every app/api/** route: paging, cursors,
 * typed errors, and the "not yet available" contract for endpoints whose backing data a
 * sibling agent (crawler analysis engine / event log / multi-site model) has not shipped yet.
 */
import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function apiError(status: number, code: string, message: string, details?: unknown): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

export function notFound(message: string): NextResponse<ApiErrorBody> {
  return apiError(404, "NOT_FOUND", message);
}

export function badRequest(message: string, details?: unknown): NextResponse<ApiErrorBody> {
  return apiError(422, "VALIDATION_ERROR", message, details);
}

/** 501: the shape is documented (PLAN-03 §7) but the backing store/process does not exist yet
 *  in this file-based POC — never a fake payload, never a 500. `awaiting` names who/what owns it. */
export function notYetAvailable(message: string, awaiting: string): NextResponse<ApiErrorBody> {
  return apiError(501, "NOT_YET_AVAILABLE", message, { awaiting });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export function parseOffsetPaging(searchParams: URLSearchParams): { page: number; pageSize: number } {
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const sizeRaw = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(MAX_PAGE_SIZE, Math.floor(sizeRaw)) : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

/** Slices an already-filtered/sorted in-memory array server-side — the client never receives
 *  more than one page regardless of run size (74-endpoint spec §7 "every list paginates"). */
export function paginate<T>(items: T[], page: number, pageSize: number): { data: T[]; page: PageMeta } {
  const total = items.length;
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);
  return { data, page: { page, pageSize, total, hasMore: start + pageSize < total } };
}

/**
 * Cursor pagination for /pages (spec §7 requires cursor, not offset, so a page inserted between
 * requests can never shift another row's position). Cursor is an opaque base64 blob carrying the
 * offset plus a signature of the filter/sort query string — changing filters mid-scroll produces
 * a typed 422 instead of silently splicing two different result sets together.
 */
export function encodeCursor(offset: number, sig: string): string {
  return Buffer.from(JSON.stringify({ o: offset, s: sig }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { offset: number; sig: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed.o === "number" && typeof parsed.s === "string") return { offset: parsed.o, sig: parsed.s };
    return null;
  } catch {
    return null;
  }
}

/** Cheap non-cryptographic signature — only needs to change when the filter/sort shape changes. */
export function querySignature(searchParams: URLSearchParams, excludeKeys: string[]): string {
  const pairs: string[] = [];
  for (const [k, v] of searchParams.entries()) {
    if (excludeKeys.includes(k)) continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  return pairs.join("&");
}

export function cursorPaginate<T>(
  items: T[],
  searchParams: URLSearchParams,
  cursorParam = "cursor",
): { data: T[]; page: { pageSize: number; total: number; hasMore: boolean; nextCursor: string | null } } | ApiErrorBody {
  const sizeRaw = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(MAX_PAGE_SIZE, Math.floor(sizeRaw)) : DEFAULT_PAGE_SIZE;
  const sig = querySignature(searchParams, [cursorParam, "pageSize"]);

  let offset = 0;
  const rawCursor = searchParams.get(cursorParam);
  if (rawCursor) {
    const decoded = decodeCursor(rawCursor);
    if (!decoded) return { error: { code: "INVALID_CURSOR", message: "Cursor is malformed." } };
    if (decoded.sig !== sig) {
      return { error: { code: "INVALID_CURSOR", message: "Cursor does not match the current filter/sort parameters." } };
    }
    offset = decoded.offset;
  }

  const total = items.length;
  const slice = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  const hasMore = nextOffset < total;
  return { data: slice, page: { pageSize, total, hasMore, nextCursor: hasMore ? encodeCursor(nextOffset, sig) : null } };
}

export function isApiErrorBody(x: unknown): x is ApiErrorBody {
  return typeof x === "object" && x !== null && "error" in x;
}

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

/** Same containment discipline as app/api/raw|replay|screenshot: dots are legal in ids, so ".."
 *  alone would clear a charset check and escape via path.join. Every route touching runId/pageId
 *  from the URL must call this before building a filesystem path. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}

export function parseSort<T extends string>(searchParams: URLSearchParams, allowed: readonly T[], fallback: T): { sort: T; order: "asc" | "desc" } {
  const raw = searchParams.get("sort");
  const sort = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";
  return { sort, order };
}

export function cmp(a: unknown, b: unknown, order: "asc" | "desc"): number {
  const dir = order === "desc" ? -1 : 1;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (a < b) return -1 * dir;
  if (a > b) return 1 * dir;
  return 0;
}
