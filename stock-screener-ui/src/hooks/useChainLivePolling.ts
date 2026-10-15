import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Chain auto-refresh cadence (15s). Exported so tests can assert against it. */
export const CHAIN_POLL_INTERVAL_MS = 15_000;
/** A chain older than two missed polls reads as STALE. */
export const CHAIN_STALE_AFTER_MS = 2 * CHAIN_POLL_INTERVAL_MS;

export interface ChainLiveState {
  /** True when the chain timestamp is fresh enough to trust. */
  live: boolean;
  /** Badge suffix: "LIVE" or "STALE 2m" / "STALE 3h" / "STALE 1d". */
  label: string;
}

/**
 * Derive LIVE/STALE display state from the chain timestamp.
 * Pure function — unit-testable without timers.
 */
export function getChainLiveState(
  timestamp: string | undefined,
  nowMs: number = Date.now(),
): ChainLiveState {
  if (!timestamp) return { live: false, label: "STALE" };
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return { live: false, label: "STALE" };
  const ageMs = nowMs - ts;
  if (ageMs <= CHAIN_STALE_AFTER_MS) return { live: true, label: "LIVE" };
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return { live: false, label: `STALE ${Math.max(1, minutes)}m` };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { live: false, label: `STALE ${hours}h` };
  return { live: false, label: `STALE ${Math.floor(hours / 24)}d` };
}

interface UseChainLivePollingOptions {
  /** Override the 15s cadence (tests use a short interval). */
  intervalMs?: number;
  /** Set false to suspend polling without unmounting. Defaults to true. */
  enabled?: boolean;
}

/**
 * Auto-refresh the option chain on a fixed cadence.
 *
 * - Polls `refreshChain` every `intervalMs` while mounted.
 * - Skips ticks while `document.hidden` (tab backgrounded) — resumes on
 *   `visibilitychange` with an immediate catch-up fetch.
 * - Guards with an in-flight flag so slow fetches never overlap.
 * - `manualRefresh` re-runs the fetch immediately AND restarts the interval
 *   clock so a manual click doesn't get followed 1s later by a scheduled tick.
 *
 * Mount this in the chain panel only: unmount (positions/greeks tabs) clears
 * the interval via effect cleanup, so no polling happens off-tab.
 */
export function useChainLivePolling(
  refreshChain: () => void | Promise<unknown>,
  timestamp: string | undefined,
  options?: UseChainLivePollingOptions,
) {
  const intervalMs = options?.intervalMs ?? CHAIN_POLL_INTERVAL_MS;
  const enabled = options?.enabled ?? true;
  const refreshRef = useRef(refreshChain);
  refreshRef.current = refreshChain;
  const inFlightRef = useRef(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const tick = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await refreshRef.current();
    } finally {
      inFlightRef.current = false;
      setNowMs(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      void tick();
    }, intervalMs);
    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, pollCycle, tick]);

  const manualRefresh = useCallback(() => {
    setPollCycle((cycle) => cycle + 1);
    void tick();
  }, [tick]);

  const liveState = useMemo(
    () => getChainLiveState(timestamp, nowMs),
    [timestamp, nowMs],
  );

  return { liveState, nowMs, manualRefresh };
}
