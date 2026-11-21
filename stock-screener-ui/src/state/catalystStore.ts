/**
 * One catalyst poll for the whole app.
 *
 * The Home Monitor radar and its session bar read this singleton; neither
 * fetches. The payload is date-scoped rather than tick data, so 30 s is the
 * floor — a per-panel loop would multiply the identical request.
 *
 * Consumers only hold a reference; the timer, the visibility listener and the
 * abort all live here, so navigating a panel away cannot leave a request or a
 * clock behind.
 */

import { createSignal, getOwner, onCleanup, type Accessor } from "solid-js";
import { isAbortError } from "../api/apiError";
import {
  CATALYST_DEFAULT_SECTOR,
  fetchCatalystsToday,
  type CatalystSectorOption,
  type CatalystToday,
} from "../api/catalysts";

/** Minimum gap between polls. */
export const CATALYST_POLL_MS = 30_000;

const FALLBACK_ERROR = "Failed to load today's catalysts";

export interface CatalystStore {
  /** Last good payload; `null` until the first successful response. */
  data: Accessor<CatalystToday | null>;
  /** True only while the first payload is on its way — a refresh keeps `data`. */
  loading: Accessor<boolean>;
  /** Last failure, cleared by the next success. Independent of `data`. */
  error: Accessor<string | null>;
  /** Currently selected sector id. */
  sector: Accessor<string>;
  /** Selector options supplied by the backend (empty until first payload). */
  sectors: Accessor<CatalystSectorOption[]>;
  setSector: (sector: string) => void;
  refresh: () => void;
}

const [version, setVersion] = createSignal(0);

let data: CatalystToday | null = null;
let loading = false;
let error: string | null = null;
let sector = CATALYST_DEFAULT_SECTOR;
/** `Date.now()` of the last successful payload; 0 means "never". */
let lastSuccessAt = 0;
let inFlight: Promise<void> | null = null;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let consumers = 0;
/** Non-component callers (tests, module bootstrap) acquire once, not per call. */
let unownedStarted = false;

function publish(): void {
  setVersion((n) => n + 1);
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

function stopTimer(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function startTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void load();
  }, CATALYST_POLL_MS);
}

/**
 * Drop the in-flight request without surfacing an abort as an error. The task's
 * own `finally` checks `controller === request`, so it cannot publish stale
 * state after this has cleared it.
 */
function abortInFlight(): void {
  const current = controller;
  controller = null;
  inFlight = null;
  current?.abort();
  if (loading) {
    loading = false;
    publish();
  }
}

function needsRefresh(): boolean {
  return data === null || Date.now() - lastSuccessAt >= CATALYST_POLL_MS;
}

function load(): Promise<void> {
  if (inFlight) return inFlight;
  // Hidden tabs do not poll; the visibility handler catches up on return.
  if (isHidden()) return Promise.resolve();

  const request = new AbortController();
  controller = request;
  if (data === null) {
    loading = true;
    publish();
  }

  const task = (async () => {
    try {
      const next = await fetchCatalystsToday(request.signal, sector);
      if (request.signal.aborted) return;
      data = next;
      error = null;
      lastSuccessAt = Date.now();
    } catch (err) {
      if (request.signal.aborted || isAbortError(err)) return;
      error = err instanceof Error && err.message ? err.message : FALLBACK_ERROR;
    } finally {
      // Only the current request may settle the shared state.
      if (controller === request) {
        controller = null;
        loading = false;
        publish();
      }
    }
  })();

  inFlight = task;
  void task.finally(() => {
    if (inFlight === task) inFlight = null;
  });
  return task;
}

function onVisibilityChange(): void {
  if (isHidden()) {
    stopTimer();
    return;
  }
  if (needsRefresh()) void load();
  startTimer();
}

function acquire(): void {
  consumers += 1;
  if (consumers > 1) return;
  document?.addEventListener?.("visibilitychange", onVisibilityChange);
  if (isHidden()) return;
  void load();
  startTimer();
}

function release(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0) return;
  stopTimer();
  document?.removeEventListener?.("visibilitychange", onVisibilityChange);
  abortInFlight();
}

function accessor<T>(read: () => T): Accessor<T> {
  return () => {
    // Reading the shared version is what makes a store change observable.
    version();
    return read();
  };
}

function setSector(next: string): void {
  const value = (next || CATALYST_DEFAULT_SECTOR).trim().toLowerCase();
  if (value === sector) return;
  sector = value;
  // A sector switch invalidates the visible rows. Keep the old payload would
  // label IT rows with the Auto sector; clear it and show the loader instead.
  abortInFlight();
  data = null;
  error = null;
  lastSuccessAt = 0;
  publish();
  void load();
}

const STORE: CatalystStore = {
  data: accessor(() => data),
  loading: accessor(() => loading),
  error: accessor(() => error),
  sector: accessor(() => sector),
  sectors: accessor(() => data?.available_sectors ?? []),
  setSector,
  refresh: () => {
    void load();
  },
};

export function useCatalystToday(): CatalystStore {
  if (getOwner()) {
    acquire();
    onCleanup(release);
  } else if (!unownedStarted) {
    // No owner to clean up on: start exactly one poll for the module lifetime.
    unownedStarted = true;
    acquire();
  }
  return STORE;
}

/** Test-only teardown, matching the store's `__resetX` convention. */
export function __resetCatalystStore(): void {
  stopTimer();
  document?.removeEventListener?.("visibilitychange", onVisibilityChange);
  abortInFlight();
  consumers = 0;
  unownedStarted = false;
  data = null;
  loading = false;
  error = null;
  sector = CATALYST_DEFAULT_SECTOR;
  lastSuccessAt = 0;
  publish();
}
