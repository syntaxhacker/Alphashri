/**
 * Event Radar API client — `/api/events/*`.
 *
 * Kept deliberately thin (mirrors `valueScan.ts`): build the URL, forward the
 * abort signal, translate a non-2xx response into an `Error` that carries both
 * the status and the server's own explanation. Everything else — caching,
 * dedupe, loading flags — belongs to `src/state/events.ts` so the UI has a
 * single owner of that state.
 *
 * `buildEventsQuery` is exported because the store also uses it as the cache
 * key: the key must be byte-identical to the request the API actually sends,
 * otherwise a cache hit can serve the wrong slice of the calendar.
 */

import { fetchWithAuth } from "../state/auth";
import type { AnomaliesResponse, EventsQuery, EventsResponse } from "../types/events";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const EVENTS_API = `${API_BASE}/api/events`;

/**
 * Serialise an `EventsQuery` into a query string WITHOUT the leading `"?"`.
 *
 * Params are emitted in a fixed order (market, from, to, types, symbols,
 * upcoming_only, limit) and only when defined, so the result is deterministic:
 * two logically-equal queries always produce the same string, which lets the
 * store use it as a cache key and lets tests assert on exact URLs.
 * An empty query produces an empty string (callers append `?` only if needed).
 */
export function buildEventsQuery(q: EventsQuery): string {
  const params = new URLSearchParams();
  if (q.market !== undefined) params.set("market", q.market);
  if (q.from !== undefined) params.set("from", q.from);
  if (q.to !== undefined) params.set("to", q.to);
  if (q.types !== undefined) params.set("types", q.types);
  if (q.symbols !== undefined) params.set("symbols", q.symbols);
  // Booleans must be "true"/"false" (not "1"/"0") — FastAPI's bool parser
  // rejects the numeric form, which would turn a filter into a 422.
  if (q.upcoming_only !== undefined) {
    params.set("upcoming_only", q.upcoming_only ? "true" : "false");
  }
  if (q.limit !== undefined) params.set("limit", String(q.limit));
  return params.toString();
}

/**
 * Extract the most useful error text from a failed response.
 *
 * Tries `text()` first (keeps a plain-text body and survives a half-written
 * JSON payload), unwraps FastAPI's `{detail: "..."}` envelope when it parses,
 * and falls back to `json()` for mocks/backends that only expose the parsed
 * body. Never throws — a body that cannot be read degrades to an empty string.
 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    if (typeof response.text === "function") {
      const raw = await response.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { detail?: unknown };
          if (parsed && typeof parsed.detail === "string" && parsed.detail) {
            return parsed.detail;
          }
        } catch {
          // Not JSON: the raw body is the detail.
        }
        return raw;
      }
    }
  } catch {
    // Body already consumed / unreadable — try the json() path below.
  }
  try {
    const parsed = (await response.json()) as { detail?: unknown };
    return parsed && typeof parsed.detail === "string" ? parsed.detail : "";
  } catch {
    return "";
  }
}

/**
 * Throw an `Error` that keeps the HTTP status AND the server's explanation.
 *
 * The status is always in the message so a caller can log/classify a failure
 * without re-reading the response, and the detail is appended verbatim so the
 * UI never has to show a bare "500" with no cause.
 */
async function throwHttpError(response: Response): Promise<never> {
  const detail = await readErrorDetail(response);
  throw new Error(
    `Events request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
  );
}

/** Append the serialised query only when non-empty (avoids a dangling `?`). */
function withQuery(path: string, q: EventsQuery): string {
  const query = buildEventsQuery(q);
  return query ? `${EVENTS_API}${path}?${query}` : `${EVENTS_API}${path}`;
}

/**
 * Fetch the event calendar for a query.
 *
 * `signal` is forwarded so the store can abort a superseded request instead of
 * letting a slow response overwrite fresher data.
 */
export async function fetchEvents(
  q: EventsQuery = {},
  opts: { signal?: AbortSignal } = {},
): Promise<EventsResponse> {
  const init: RequestInit = opts.signal ? { signal: opts.signal } : {};
  const response = await fetchWithAuth(withQuery("/calendar", q), init);
  if (!response.ok) await throwHttpError(response);
  return (await response.json()) as EventsResponse;
}

/** Fetch everything happening today (server picks the day, in its own tz). */
export async function fetchTodayEvents(
  opts: { signal?: AbortSignal } = {},
): Promise<EventsResponse> {
  const init: RequestInit = opts.signal ? { signal: opts.signal } : {};
  const response = await fetchWithAuth(withQuery("/today", {}), init);
  if (!response.ok) await throwHttpError(response);
  return (await response.json()) as EventsResponse;
}

/**
 * Fetch unexplained 1-minute anomalies for a session (`YYYY-MM-DD`).
 *
 * Kept separate from the calendar because the panel reloads anomalies without
 * touching (or invalidating) the 90-day calendar payload.
 */
export async function fetchAnomalies(
  date: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AnomaliesResponse> {
  const init: RequestInit = opts.signal ? { signal: opts.signal } : {};
  // `date` is not part of `EventsQuery` (it is a session selector, not a
  // calendar filter), so this URL is built directly rather than via
  // `buildEventsQuery` — which would silently drop the param.
  const params = new URLSearchParams({ date });
  const response = await fetchWithAuth(`${EVENTS_API}/anomalies?${params.toString()}`, init);
  if (!response.ok) await throwHttpError(response);
  return (await response.json()) as AnomaliesResponse;
}

/**
 * Ask the backend to re-ingest its event sources.
 *
 * Returns `{ok}` rather than the raw body so the store has a stable shape even
 * when the endpoint answers `204 No Content` (or a proxy strips the body).
 */
export async function refreshEvents(): Promise<{ ok: boolean }> {
  const response = await fetchWithAuth(`${EVENTS_API}/refresh`, { method: "POST" });
  if (!response.ok) await throwHttpError(response);
  try {
    const body = (await response.json()) as { ok?: unknown } | null;
    return { ok: body?.ok !== false };
  } catch {
    return { ok: true };
  }
}
