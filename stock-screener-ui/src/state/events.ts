/**
 * Event Radar store (subscriber-based, same pattern as `chartPatterns.ts`).
 *
 * The store owns the calendar payload, the anomaly payload, the query and all
 * loading/error flags. Components never call `useState` for this data — they
 * subscribe through `useEventsStore` / `useEvents` so two panels showing the
 * calendar always agree on the same query and the same rows.
 *
 * Two invariants worth knowing before editing:
 *  1. Requests are abortable and generation-guarded. A superseded response is
 *     ignored, otherwise a slow US scan can land after a fast India scan and
 *     paint the wrong market.
 *  2. The cache key is `buildEventsQuery(query)` — the exact query string the
 *     API sends — so a hit is guaranteed to match the request that would have
 *     gone out.
 */

import { useSyncExternalStore } from "react";

import { createSubscriber } from "./createSubscriber";
import {
  buildEventsQuery,
  fetchAnomalies,
  fetchEvents,
  refreshEvents,
} from "../api/events";
import type { AnomaliesResponse, EventsQuery, EventsResponse } from "../types/events";

/** Calendar window length in days (today → today + 90). */
const DEFAULT_RANGE_DAYS = 90;
/** Row ceiling for one calendar load; the quarterly window is ~500 rows. */
const DEFAULT_LIMIT = 500;

/**
 * Human-readable prefix kept in `error.message`.
 *
 * The UI renders `error.message` directly, so it must start with a sentence a
 * user can act on; the technical detail (HTTP status, server message) is
 * appended after it so debugging does not require a second source of truth.
 */
const CALENDAR_ERROR = "Could not load the event calendar.";
const ANOMALIES_ERROR = "Could not load the event anomalies.";
const REFRESH_ERROR = "Could not refresh the event sources.";

export interface EventsState {
  query: EventsQuery;
  data: EventsResponse | null;
  anomalies: AnomaliesResponse | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  lastUpdated: string | null;
}

/**
 * Format a `Date` as `YYYY-MM-DD` using LOCAL date parts.
 *
 * `toISOString()` converts to UTC first, so an IST user (UTC+5:30) at 00:30
 * would get yesterday's date — the calendar would silently open one day early.
 * Reading `getFullYear/getMonth/getDate` keeps the user's calendar day.
 */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Shift a date by whole days without mutating it (DST-safe via `setDate`). */
function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The query used on first load: US market, next 90 days, future events only.
 *
 * This is the product's default lens ("what is coming up"), so it lives in the
 * store rather than in each panel — a panel that mounted with no query must
 * still see exactly this range.
 */
function defaultQuery(now: Date = new Date()): EventsQuery {
  return {
    market: "us",
    from: isoDate(now),
    to: isoDate(addDays(now, DEFAULT_RANGE_DAYS)),
    upcoming_only: true,
    limit: DEFAULT_LIMIT,
  };
}

/**
 * Restore the default date window when a caller clears `from`/`to`.
 *
 * An empty range is never what the user means (it would request "everything"),
 * so clearing a date resets it to today/today+90 instead of producing an
 * unbounded query.
 */
function withDefaultRange(query: EventsQuery, now: Date = new Date()): EventsQuery {
  const fallback = defaultQuery(now);
  return {
    ...query,
    from: query.from ? query.from : fallback.from,
    to: query.to ? query.to : fallback.to,
  };
}

function createInitialState(): EventsState {
  return {
    query: defaultQuery(),
    data: null,
    anomalies: null,
    isLoading: false,
    isRefreshing: false,
    error: null,
    lastUpdated: null,
  };
}

let state: EventsState = createInitialState();

/** Scored calendar payloads keyed by `buildEventsQuery` (never by filter object). */
const cache = new Map<string, EventsResponse>();

let calendarController: AbortController | null = null;
let anomaliesController: AbortController | null = null;
/**
 * Monotonic generations. A response whose generation is no longer current is
 * stale and must not touch state (otherwise an old slow request wins).
 */
let calendarGeneration = 0;
let anomaliesGeneration = 0;
/** In-flight counters: `isLoading` is true while either loader is running. */
let calendarInflight = 0;
let anomaliesInflight = 0;
/**
 * Per-loader error slots.
 *
 * The public `error` field is one slot the UI renders, but the two loaders run
 * independently: the panel fires the calendar and the anomaly feed at the same
 * time. Sharing one field means whichever request settles last erases the
 * other's failure — a 500 on the calendar vanished the moment a healthy
 * anomaly feed resolved. Each loader therefore owns its error and `error`
 * publishes the calendar one first (it is the payload the table needs).
 */
let calendarError: Error | null = null;
let anomaliesError: Error | null = null;

const { subscribe, notify } = createSubscriber();

/** Read the current snapshot — the single source components render from. */
function getState(): EventsState {
  return state;
}

function apply(partial: Partial<EventsState>): void {
  state = { ...state, ...partial };
  notify();
}

function syncLoading(): void {
  apply({ isLoading: calendarInflight + anomaliesInflight > 0 });
}

/**
 * Publish the combined error alongside other state changes.
 *
 * Always passes `error` explicitly so a caller's partial can never leave a
 * stale message on screen after the owning loader recovered.
 */
function syncError(partial: Partial<EventsState> = {}): void {
  apply({ ...partial, error: calendarError ?? anomaliesError });
}

/**
 * Convert any thrown value into the user-facing error.
 *
 * The friendly prefix is always present; the technical detail rides along in
 * the same `message` so `error.message` stays copy-pasteable into a bug report.
 */
function toFriendlyError(prefix: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error ?? "").trim();
  if (!detail || detail === prefix) return new Error(prefix);
  return new Error(`${prefix} ${detail}`);
}

/**
 * Load the calendar, reusing a cached payload for the same query string.
 *
 * `query` overrides the stored query (used by `setQuery` and `refresh`). The
 * cache hit path applies synchronously — before any await — so a re-mount with
 * the same filters renders rows on the first paint instead of flashing a
 * spinner.
 */
async function loadCalendar(query?: EventsQuery): Promise<void> {
  const next = withDefaultRange(query ?? state.query);
  const key = buildEventsQuery(next);

  // A new load supersedes the previous one: abort it and bump the generation
  // so its (late) result can never win.
  calendarController?.abort();
  const controller = new AbortController();
  calendarController = controller;
  const generation = ++calendarGeneration;

  calendarError = null;
  syncError({ query: next });

  const cached = cache.get(key);
  if (cached) {
    syncError({
      data: cached,
      lastUpdated: cached.meta?.as_of ?? state.lastUpdated,
    });
    return;
  }

  calendarInflight += 1;
  syncLoading();
  try {
    const response = await fetchEvents(next, { signal: controller.signal });
    if (generation !== calendarGeneration || controller.signal.aborted) return;
    cache.set(key, response);
    calendarError = null;
    syncError({
      data: response,
      lastUpdated: response.meta?.as_of ?? new Date().toISOString(),
    });
  } catch (error) {
    if (generation !== calendarGeneration || controller.signal.aborted) return;
    calendarError = toFriendlyError(CALENDAR_ERROR, error);
    syncError();
  } finally {
    calendarInflight = Math.max(0, calendarInflight - 1);
    // Counters (not the generation) decide the spinner: an aborted older
    // request still owns one unit, and always releasing it is what keeps
    // `isLoading` from sticking true when the newest request settles first.
    syncLoading();
  }
}

/**
 * Load the anomaly feed for one session.
 *
 * Anomalies are intentionally NOT cached: the tripwire list is what a trader
 * re-checks intraday, and a stale list is worse than a slow one.
 */
async function loadAnomalies(date: string): Promise<void> {
  anomaliesController?.abort();
  const controller = new AbortController();
  anomaliesController = controller;
  const generation = ++anomaliesGeneration;

  anomaliesError = null;
  syncError();
  anomaliesInflight += 1;
  syncLoading();
  try {
    const response = await fetchAnomalies(date, { signal: controller.signal });
    if (generation !== anomaliesGeneration || controller.signal.aborted) return;
    anomaliesError = null;
    syncError({ anomalies: response });
  } catch (error) {
    if (generation !== anomaliesGeneration || controller.signal.aborted) return;
    anomaliesError = toFriendlyError(ANOMALIES_ERROR, error);
    syncError();
  } finally {
    anomaliesInflight = Math.max(0, anomaliesInflight - 1);
    syncLoading();
  }
}

/**
 * Change the query and reload.
 *
 * A partial patch is merged onto the current query, then the date window is
 * repaired if the caller cleared it. Kept separate from `loadCalendar` so the
 * caller does not have to pass the whole query just to switch market.
 */
function setQuery(patch: Partial<EventsQuery>): void {
  const merged = withDefaultRange({ ...state.query, ...patch });
  void loadCalendar(merged);
}

/**
 * Re-ingest the server's sources, then reload the calendar.
 *
 * The cache is cleared BEFORE the POST so the reload cannot be served from the
 * payload the refresh was meant to replace.
 */
async function refresh(): Promise<void> {
  cache.clear();
  calendarError = null;
  syncError({ isRefreshing: true });
  try {
    await refreshEvents();
  } catch (error) {
    calendarError = toFriendlyError(REFRESH_ERROR, error);
    apply({ isRefreshing: false });
    syncError();
    return;
  }
  try {
    await loadCalendar(state.query);
  } finally {
    apply({ isRefreshing: false });
  }
}

/**
 * Reset every field, abort in-flight work and drop the cache.
 *
 * Primary use is tests and route teardown: module state otherwise leaks
 * between test cases (a cached payload from one test masks the fetch in the
 * next).
 */
function reset(): void {
  calendarController?.abort();
  anomaliesController?.abort();
  calendarController = null;
  anomaliesController = null;
  calendarGeneration = 0;
  anomaliesGeneration = 0;
  calendarInflight = 0;
  anomaliesInflight = 0;
  calendarError = null;
  anomaliesError = null;
  cache.clear();
  state = createInitialState();
  notify();
}

export const eventsStore: {
  getState(): EventsState;
  subscribe(fn: (s: EventsState) => void): () => void;
  setQuery(patch: Partial<EventsQuery>): void;
  loadCalendar(query?: EventsQuery): Promise<void>;
  loadAnomalies(date: string): Promise<void>;
  refresh(): Promise<void>;
  reset(): void;
} = {
  getState,
  // `notify` calls its subscribers with no argument; the store exposes the
  // documented `(s: EventsState) => void` shape and forwards the current state
  // so a listener can read it without a second call.
  subscribe: (fn) => subscribe(() => fn(state)),
  setQuery,
  loadCalendar,
  loadAnomalies,
  refresh,
  reset,
};

/**
 * Subscribe a component to the store and return the current state.
 *
 * `useSyncExternalStore` (rather than the local `useStoreSubscription` +
 * `getState()` pair) is what React requires for an external store: it
 * re-reads the snapshot on every notification and guarantees the component
 * never renders a value older than the last notify. The manual
 * force-update version silently stopped re-rendering this panel when it was
 * lazy-mounted inside a Suspense boundary, which is exactly the tearing
 * class `useSyncExternalStore` exists to prevent.
 */
export function useEventsStore(): EventsState {
  return useSyncExternalStore(subscribe, getState, getState);
}
