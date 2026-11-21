import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
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
  enabled: () => boolean;
  symbol: () => string;
  date?: () => string | undefined;
  /** Replay cutoff (frame ISO timestamp). */
  at?: () => string | undefined;
  /** The walls drawer is open (`map=1`) — bypass the throttle. */
  includeMap?: () => boolean;
  live: boolean;
  /** Live `report` identity, throttled by the caller. */
  liveTick?: () => unknown;
  /** Default 150 ms for EOD scrubbing; callers pass 4000 for live. */
  throttleMs?: number;
  /** Injectable for tests. */
  fetcher?: typeof fetchOptionsWalls;
}

export interface ReplayWallsResult {
  walls: () => WallsPayload | null;
  syncing: () => boolean;
}

export function useReplayWalls(opts: ReplayWallsOptions): ReplayWallsResult {
  const enabled = () => opts.enabled();
  const symbol = () => opts.symbol();
  const date = () => opts.date?.();
  const at = () => opts.at?.();
  const includeMap = () => opts.includeMap?.() ?? false;
  const liveTick = () => opts.liveTick?.();
  const throttleMs = opts.throttleMs ?? (opts.live ? 4_000 : 150);
  const fetcher = opts.fetcher ?? fetchOptionsWalls;

  const [walls, setWalls] = createSignal<WallsPayload | null>(null);
  const [syncing, setSyncing] = createSignal(false);

  // Track the latest requested cutoff; the settle path and the trailing
  // timer read it live, so the request always targets the current playhead.
  const contextKey = createMemo(() => `${symbol()}|${date() ?? ""}`);
  let contextRef = contextKey();
  let mounted = true;
  /** Invalidates every in-flight response on context change / disable. */
  let epoch = 0;
  /** Requests currently running (pipelining can overlap up to ~2). */
  let inFlight = 0;
  let lastStart = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Cutoff of the payload currently on screen; keeps out-of-order replies
   *  from walking the card back to an older minute. */
  let appliedAt: string | undefined;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runFetch = () => {
    if (!enabled()) return;

    const requestAt = at();
    const requestEpoch = epoch;
    inFlight += 1;
    lastStart = Date.now();
    setSyncing(true);

    const settle = (data: WallsPayload | null) => {
      if (!mounted) return;
      inFlight = Math.max(0, inFlight - 1);
      if (requestEpoch !== epoch) return; // context changed / disabled

      const prev = appliedAt;
      const atNow = at();

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
          if (requestAt) appliedAt = requestAt;
        }
      }
      if (inFlight === 0) {
        setSyncing(false);
        // The playhead moved while the last request was in flight — chase it
        // now instead of leaving the card on a stale minute.
        if (at() !== requestAt) runFetch();
      }
    };

    let request: Promise<WallsPayload | null>;
    try {
      // No AbortSignal: aborting per scrub tick is exactly what starved the
      // card. Staleness is handled by the epoch + cutoff checks above.
      request = Promise.resolve(fetcher(symbol(), date(), requestAt, undefined, includeMap()));
    } catch {
      request = Promise.resolve(null);
    }
    request.then(settle, () => settle(null));
  };

  // A context change (symbol/date) never reuses the previous card: the old
  // symbol's walls would paint over the new chain until the first payload.
  createEffect(() => {
    const key = contextKey();
    if (contextRef === key) return;
    contextRef = key;
    epoch += 1;
    inFlight = 0;
    lastStart = 0;
    appliedAt = undefined;
    clearTimer();
    setWalls(null);
    setSyncing(false);
  });

  onCleanup(() => {
    mounted = false;
    epoch += 1;
    inFlight = 0;
    clearTimer();
  });

  createEffect(() => {
    // Track every field the fetch depends on.
    enabled();
    at();
    includeMap();
    liveTick();
    contextKey();
    if (!enabled()) {
      // Disabling invalidates in-flight responses (e.g. context reset).
      epoch += 1;
      inFlight = 0;
      clearTimer();
      setSyncing(false);
      return;
    }

    if (inFlight > 0) {
      const elapsedInFlight = Date.now() - lastStart;
      // Inside the window: the settle path chases the newest cutoff.
      if (!includeMap() && elapsedInFlight < throttleMs) return;
      // Window elapsed: start the newest cutoff now; the older response still
      // paints if it is newer than what is displayed (progressive).
      clearTimer();
      runFetch();
      return;
    }

    const elapsed = Date.now() - lastStart;
    if (!includeMap() && elapsed < throttleMs) {
      // One trailing timer only — a second one would fan out the same request.
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (inFlight > 0) return;
        runFetch();
      }, throttleMs - elapsed);
      return;
    }

    // Drawer opened (map=1) or the window elapsed: fetch now, drop the timer.
    clearTimer();
    runFetch();
  });

  return { walls, syncing };
}
