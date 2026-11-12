import { createEffect, onCleanup } from "solid-js";

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
 * Shared replacement for ad-hoc `setInterval` loops.
 *
 * - Only sets an interval when `enabled && ms > 0`.
 * - Clears the interval on unmount and whenever `enabled`/`ms` change.
 * - `immediate` invokes `fn` once after mount (and whenever the effect re-arms).
 * - `pauseWhenHidden` pauses while the tab is hidden, with a catch-up tick on resume.
 * - `skipIfRunning` prevents overlapping async invocations.
 *
 * `fn` is held in a ref so replacing it never restarts the clock.
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

  const fnRef = { current: fn };
  fnRef.current = fn;
  const runningRef = { current: false };
  let timer: ReturnType<typeof setInterval> | null = null;

  const clearTimer = () => {
    const id = timer;
    if (id !== null) {
      clearInterval(id);
      timer = null;
    }
  };

  const invoke = () => {
    if (!enabled) return;
    if (skipIfRunning && runningRef.current) return;
    let result: void | Promise<void>;
    try {
      result = fnRef.current();
    } catch {
      return;
    }
    if (skipIfRunning && result instanceof Promise) {
      runningRef.current = true;
      result.finally(() => {
        runningRef.current = false;
      }).catch(() => {
        // Swallow rejections so a failed tick never blocks subsequent polls.
      });
    }
  };

  createEffect(() => {
    clearTimer();
    if (!enabled || !Number.isFinite(ms) || ms <= 0) return;
    timer = setInterval(invoke, ms);
  });
  onCleanup(() => clearTimer());

  createEffect(() => {
    if (!enabled || !immediate) return;
    invoke();
  });

  if (pauseWhenHidden) {
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else {
        invoke();
        clearTimer();
        if (enabled && ms > 0) {
          timer = setInterval(invoke, ms);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    });
  }
}
