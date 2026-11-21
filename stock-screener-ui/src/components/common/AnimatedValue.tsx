import { createEffect, createSignal, onCleanup } from "solid-js";

export type FlashDirection = "up" | "down";

/**
 * Direction of a numeric change, or null when nothing visibly changed.
 * Null/undefined/non-finite on either side never flashes, and neither does
 * an equal value — only a real finite-to-finite change has a direction.
 */
export function flashDirection(
  prev: number | null | undefined,
  next: number | null | undefined,
): FlashDirection | null {
  if (prev === null || prev === undefined) return null;
  if (next === null || next === undefined) return null;
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  if (next > prev) return "up";
  if (next < prev) return "down";
  return null;
}

/** Matches the 0.6s `flash-up` / `flash-down` keyframes in src/style.css. */
const FLASH_MS = 600;
const FLASH_UP_CLASS = "price-flash-up";
const FLASH_DOWN_CLASS = "price-flash-down";

export interface AnimatedValueProps {
  value: number | null | undefined;
  format?: (v: number) => string;
  className?: string;
  testId?: string;
}

/**
 * Number that briefly flashes green/red when it changes between polls.
 * Reuses the global `.price-flash-up` / `.price-flash-down` classes from
 * src/style.css — no new CSS. The first render never flashes (the initial
 * value is recorded as the baseline), and transitions to/from
 * null/undefined/non-finite render an em dash without flashing.
 */
export function AnimatedValue(props: AnimatedValueProps) {
  const [flash, setFlash] = createSignal<FlashDirection | null>(null);
  let prev: number | null | undefined = props.value;
  let mounted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const value = props.value;
    // Mount: record the baseline, never flash on first paint.
    if (!mounted) {
      mounted = true;
      prev = value;
      return;
    }
    const dir = flashDirection(prev, value);
    prev = value;
    if (dir === null) return;
    setFlash(dir);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      setFlash(null);
      timer = null;
    }, FLASH_MS);
  });

  onCleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });

  const text = () =>
    props.value === null || props.value === undefined || !Number.isFinite(props.value)
      ? "—"
      : props.format
        ? props.format(props.value)
        : String(props.value);
  const combined = () =>
    [props.className, flash() === "up" ? FLASH_UP_CLASS : flash() === "down" ? FLASH_DOWN_CLASS : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <span data-testid={props.testId} className={combined() || undefined}>
      {text()}
    </span>
  );
}
