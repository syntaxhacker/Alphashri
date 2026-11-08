/**
 * Pure helpers shared by the chart-patterns API client and store for turning
 * filter objects into query strings. No React, no fetch, no app state.
 *
 * Keeping these in one place means the emitted query string for a given
 * filter set is defined exactly once — order of params is the order of the
 * spec passed to `appendParams`/`buildQueryString`, so byte-identical URLs
 * for identical inputs are preserved.
 */

/** One param value in an ordered serialization spec. */
export type QueryParamValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined;

/** An ordered `[key, value]` entry; keys may repeat (arrays append element-wise). */
export type QueryParamEntry = readonly [string, QueryParamValue];

const LIST_SPLIT_RE = /[\s,;|]+/;

/**
 * Append every element of a multi-value filter under `key` (repeated keys),
 * preserving order. A nullish array appends nothing. Values are passed
 * through untouched — callers that need cleaning should run
 * `normalizeFilterArray`/`normalizeSymbolList` first.
 */
export function appendAll(
  params: URLSearchParams,
  key: string,
  values: readonly string[] | null | undefined,
): void {
  for (const value of values ?? []) params.append(key, value);
}

/**
 * Serialize an ordered spec into `params`:
 * - `null`/`undefined` entries are omitted;
 * - a string array appends one `key=value` per element (order preserved);
 * - a non-empty string sets `key=value` (empty strings are omitted);
 * - numbers and booleans always serialize (`0` and `false` are kept).
 */
export function appendParams(
  params: URLSearchParams,
  entries: readonly QueryParamEntry[],
): void {
  for (const [key, value] of entries) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      appendAll(params, key, value);
      continue;
    }
    if (typeof value === "string") {
      if (value) params.set(key, value);
      continue;
    }
    params.set(key, String(value));
  }
}

/** Serialize an ordered spec into `"?a=b&c=d"` (empty string when nothing serializes). */
export function buildQueryString(entries: readonly QueryParamEntry[]): string {
  const params = new URLSearchParams();
  appendParams(params, entries);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Normalize a free-text filter list: trim each item, drop empties,
 * de-duplicate preserving first occurrence. Accepts either an array (store
 * path — elements are NOT split) or a single separator-delimited string
 * (`a, b;c|d e` — split on whitespace/commas/semicolons/pipes).
 * With `upper`, items are upper-cased (symbol style).
 */
export function normalizeFilterArray(
  input: string | readonly unknown[] | null | undefined,
  opts: { upper?: boolean } = {},
): string[] {
  const items: readonly unknown[] =
    typeof input === "string" ? input.split(LIST_SPLIT_RE) : (input ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    let item = String(raw ?? "").trim();
    if (opts.upper) item = item.toUpperCase();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Normalize a symbol list (array or delimited string): trim, upper-case, de-dupe. */
export function normalizeSymbolList(
  input: string | readonly unknown[] | null | undefined,
): string[] {
  return normalizeFilterArray(input, { upper: true });
}
