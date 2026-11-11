import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptionsWalls } from "@/api/reportNifty";
import type { WallsPayload } from "@/api/reportNifty";

/**
 * Walls card data for a scrubbing replay.
 *
 * The old inline effect aborted the previous request on every `replayIndex`
 * change. `/walls?at=` takes 100-400 ms, so a continuous drag never let a
 * single request finish: the card froze while the chart and heatmap moved.
 *
 * This hook is throttle-with-catch-up and paints progressively:
 *   - the first tick fetches immediately;
 *   - further ticks inside the throttle window collapse into ONE trailing
 *     timer that reads the latest cutoff when it fires;
 *   - once the throttle window elapses a newer request may start while an
 *     older one is still in flight (pipelining), so the card keeps moving;
 *   - every response paints if its cutoff is at/after the displayed one, so a
 *     drag shows intermediate minutes instead of waiting for the final one;
 *   - a symbol/date change, a disable, or unmount bumps an epoch that
 *     invalidates every request from the old context, so a late payload can
 *     never paint on a chain it does not belong to.
 */
export interface ReplayWallsOptions {
  enabled: boolean;
  symbol: string;
  date?: string;
  /** Replay cutoff (frame ISO timestamp). */
  at?: string;
  /** The walls drawer is open (`map=1`) — bypass the throttle. */
  includeMap?: boolean;
  live: boolean;
  /** Live `report` identity, throttled by the caller. */
  liveTick?: unknown;
  /** Default 150 ms for EOD scrubbing; callers pass 4000 for live. */
  throttleMs?: number;
  /** Injectable for tests. */
  fetcher?: typeof fetchOptionsWalls;
}

export interface ReplayWallsResult {
  walls: WallsPayload | null;
  syncing: boolean;
}

export function useReplayWalls(opts: ReplayWallsOptions): ReplayWallsResult {
  const {
    enabled,
    symbol,
    date,
    at,
    includeMap = false,
    live,
    liveTick,
    throttleMs = live ? 4_000 : 150,
    fetcher = fetchOptionsWalls,
  } = opts;

  const [walls, setWalls] = useState<WallsPayload | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Latest requested cutoff. A pending trailing timer and the settle-path
  // catch-up read this instead of the value captured by the effect, so the
  // request always targets the playhead the user is currently on.
  const atRef = useRef<string | undefined>(at);
  atRef.current = at;

  // Everything the fetch needs, read at call time (never captured stale).
  const cfgRef = useRef({ enabled, symbol, date, includeMap, fetcher });
  cfgRef.current = { enabled, symbol, date, includeMap, fetcher };

  const contextKey = `${symbol}|${date ?? ""}`;
  const contextRef = useRef(contextKey);
  const mountedRef = useRef(true);
  /** Invalidates every in-flight response on context change / disable. */
  const epochRef = useRef(0);
  /** Requests currently running (pipelining can overlap up to ~2). */
  const inFlightRef = useRef(0);
  const lastStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cutoff of the payload currently on screen; keeps out-of-order replies
   *  from walking the card back to an older minute. */
  const appliedAtRef = useRef<string | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runFetchRef = useRef<() => void>(() => undefined);

  const runFetch = useCallback(() => {
    const cfg = cfgRef.current;
    if (!cfg.enabled) return;

    const requestAt = atRef.current;
    const requestEpoch = epochRef.current;
    inFlightRef.current += 1;
    lastStartRef.current = Date.now();
    setSyncing(true);

    const settle = (data: WallsPayload | null) => {
      if (!mountedRef.current) return;
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      if (requestEpoch !== epochRef.current) return; // context changed / disabled

      const prev = appliedAtRef.current;
      const atNow = atRef.current;

      // Never paint a payload whose requested cutoff is after the current
      // playhead. A late future response that arrives after the user scrubbed
      // back must be discarded, not painted — the card must not show a future
      // frame while the playhead sits on an older minute. In-flight is already
      // decremented above; catch-up still runs below.
      if (requestAt && atNow && requestAt > atNow) {
        // discard intentionally — do not paint, do not move appliedAtRef.
      } else {
        // Allow an older cutoff to paint when the playhead moved backwards, so
        // scrubbing back (11:36 -> 11:33) lands on the older frame instead of
        // leaving the card on the future minute.
        const movingBack = Boolean(requestAt && prev && atNow && atNow < prev);
        const isNewer = !requestAt || !prev || requestAt >= prev || movingBack;
        if (data && isNewer) {
          setWalls(data);
          if (requestAt) appliedAtRef.current = requestAt;
        }
      }
      if (inFlightRef.current === 0) {
        setSyncing(false);
        // The playhead moved while the last request was in flight — chase it
        // now instead of leaving the card on a stale minute.
        if (atRef.current !== requestAt) runFetchRef.current();
      }
    };

    let request: Promise<WallsPayload | null>;
    try {
      // No AbortSignal: aborting per scrub tick is exactly what starved the
      // card. Staleness is handled by the epoch + cutoff checks above.
      request = Promise.resolve(cfg.fetcher(cfg.symbol, cfg.date, requestAt, undefined, cfg.includeMap));
    } catch {
      request = Promise.resolve(null);
    }
    request.then(settle, () => settle(null));
  }, []);
  runFetchRef.current = runFetch;

  // A context change (symbol/date) never reuses the previous card: the old
  // symbol's walls would paint over the new chain until the first payload.
  useEffect(() => {
    if (contextRef.current === contextKey) return;
    contextRef.current = contextKey;
    epochRef.current += 1;
    inFlightRef.current = 0;
    lastStartRef.current = 0;
    appliedAtRef.current = undefined;
    clearTimer();
    setWalls(null);
    setSyncing(false);
  }, [contextKey, clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      inFlightRef.current = 0;
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) {
      // Disabling invalidates in-flight responses (e.g. context reset).
      epochRef.current += 1;
      inFlightRef.current = 0;
      clearTimer();
      setSyncing(false);
      return;
    }

    if (inFlightRef.current > 0) {
      const elapsedInFlight = Date.now() - lastStartRef.current;
      // Inside the window: the settle path chases the newest cutoff.
      if (!includeMap && elapsedInFlight < throttleMs) return;
      // Window elapsed: start the newest cutoff now; the older response still
      // paints if it is newer than what is displayed (progressive).
      clearTimer();
      runFetch();
      return;
    }

    const elapsed = Date.now() - lastStartRef.current;
    if (!includeMap && elapsed < throttleMs) {
      // One trailing timer only — a second one would fan out the same request.
      if (timerRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (inFlightRef.current > 0) return;
        runFetchRef.current();
      }, throttleMs - elapsed);
      return;
    }

    // Drawer opened (map=1) or the window elapsed: fetch now, drop the timer.
    clearTimer();
    runFetch();
  }, [enabled, at, includeMap, throttleMs, liveTick, contextKey, clearTimer, runFetch]);

  return { walls, syncing };
}
