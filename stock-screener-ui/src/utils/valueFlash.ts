import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

export type FlashDirection = "up" | "down" | "flat";

export interface ValueFlash {
  /** Current direction; "flat" whenever no flash is active. */
  direction: () => FlashDirection;
  /** Class to place on the numeric cell — "" when there is nothing to animate. */
  className: () => string;
  /**
   * Monotonic counter bumped only on a real change. Hand this to a keyed cell
   * (or a `data-flash-key` attribute) so a fresh change restarts the CSS
   * animation even while the direction class is still applied.
   */
  key: () => number;
}

/** Matches the `valueFlashUp` / `valueFlashDown` animation in tailwind.css. */
export const DEFAULT_FLASH_MS = 600;

function isFiniteNumber(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function directionOf(
  value: number | null | undefined,
  previous: number | null | undefined,
): FlashDirection {
  // No comparison is possible without two finite numbers — that includes the
  // first render (previous == null) and a null/non-finite tick.
  if (!isFiniteNumber(value) || !isFiniteNumber(previous)) return "flat";
  if (value > previous) return "up";
  if (value < previous) return "down";
  return "flat";
}

/** Pure direction-to-class mapping, usable without the reactive hook. */
export function flashClass(
  value: number | null | undefined,
  previous: number | null | undefined,
): string {
  const direction = directionOf(value, previous);
  return direction === "up" ? "value-flash-up" : direction === "down" ? "value-flash-down" : "";
}

/**
 * Brief terminal-style flash for a numeric cell that changes on a data tick.
 *
 * Only `value()` is tracked by the effect. `previous` is deliberately read and
 * written through `untrack`/a setter the effect never subscribes to, so the
 * effect cannot re-trigger itself. The three exposed accessors are written but
 * never read here, for the same reason.
 */
export function useValueFlash(
  value: () => number | null | undefined,
  durationMs: number = DEFAULT_FLASH_MS,
): ValueFlash {
  const [direction, setDirection] = createSignal<FlashDirection>("flat");
  const [className, setClassName] = createSignal("");
  const [key, setKey] = createSignal(0);
  const [previous, setPrevious] = createSignal<number | null | undefined>(undefined);

  let first = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  createEffect(() => {
    const current = value();
    const prev = untrack(previous);
    setPrevious(current);

    // The first observation only seeds the baseline: no flash, no sequence bump.
    if (first) {
      first = false;
      return;
    }

    const next = directionOf(current, prev);
    if (next === "flat") {
      clearTimer();
      setDirection("flat");
      setClassName("");
      return;
    }

    setDirection(next);
    setClassName(next === "up" ? "value-flash-up" : "value-flash-down");
    setKey((n) => n + 1);

    // Dropping the class after the animation lets a later change restart it
    // naturally; the key is there for consumers that key the DOM node instead.
    clearTimer();
    timer = setTimeout(() => {
      setDirection("flat");
      setClassName("");
      timer = null;
    }, durationMs);
  });

  onCleanup(clearTimer);

  return { direction, className, key };
}
