import { useCallback, useEffect, useRef } from "react";

export interface UsePollingOptions {
  /** Whether polling is active. Defaults to true. */
  enabled?: boolean;
  /** Invoke the callback once immediately on mount. Defaults to false. */
  immediate?: boolean;
  /** Pause the interval while the tab is hidden and resume on visible. Defaults to false. */
  pauseWhenHidden?: boolean;
  /** Skip a tick if the previous async invocation is still in flight. Defaults to true. */
  skipIfRunning?: boolean;
}

/**
 * Shared replacement for ad-hoc `useEffect(() => { setInterval(tick, ms); ... })` blocks.
 *
 * - Only sets an interval when `enabled && ms > 0`.
 * - Clears the interval on unmount and whenever `enabled`/`ms`/`fn` change.
 * - `immediate` invokes `fn` once on mount (and whenever the effect re-arms).
 * - `pauseWhenHidden` listens to `document.visibilitychange`, clears the interval
 *   while hidden and runs a catch-up tick + restarts the cadence when visible.
 * - `skipIfRunning` prevents overlapping async invocations.
 *
 * The callback is kept in a ref so changing `fn` does not restart the clock; only
 * `enabled`, `ms`, `skipIfRunning` and `immediate` re-arm the interval.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  ms: number,
  opts: UsePollingOptions = {},
): void {
  const {
    enabled = true,
    immediate = false,
    pauseWhenHidden = false,
    skipIfRunning = true,
  } = opts;

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    const id = timerRef.current;
    if (id !== null) {
      clearInterval(id);
      timerRef.current = null;
    }
  }, []);

  const invoke = useCallback(() => {
    if (!enabled) return;
    if (skipIfRunning && runningRef.current) return;
    let result: void | Promise<void>;
    try {
      result = fnRef.current();
    } catch {
      // A synchronous throw from a poll tick must not kill the interval.
      return;
    }
    if (skipIfRunning && result instanceof Promise) {
      runningRef.current = true;
      result.finally(() => {
        runningRef.current = false;
      }).catch(() => {
        // Swallow rejections so a failed tick never becomes an unhandled
        // rejection and never blocks subsequent polls.
      });
    }
  }, [enabled, skipIfRunning]);

  // ---- interval -----------------------------------------------------------
  useEffect(() => {
    clearTimer();
    // `parseInt("off")` yields NaN, and `NaN <= 0` is false — without the
    // isFinite guard a bad interval becomes a zero-delay timer storm.
    if (!enabled || !Number.isFinite(ms) || ms <= 0) return;
    timerRef.current = setInterval(invoke, ms);
    return () => {
      clearTimer();
    };
  }, [enabled, ms, invoke, clearTimer]);

  // ---- immediate ----------------------------------------------------------
  useEffect(() => {
    if (!enabled || !immediate) return;
    invoke();
  }, [enabled, immediate, invoke]);

  // ---- pause when hidden --------------------------------------------------
  useEffect(() => {
    if (!pauseWhenHidden) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else {
        // Tab became visible: run a catch-up tick and restart the cadence.
        invoke();
        clearTimer();
        if (enabled && ms > 0) {
          timerRef.current = setInterval(invoke, ms);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    };
  }, [pauseWhenHidden, enabled, ms, invoke, clearTimer]);
}
