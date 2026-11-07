import { useEffect, useRef, useState } from "react";

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
export function AnimatedValue({
  value,
  format,
  className,
  testId,
}: AnimatedValueProps) {
  const [flash, setFlash] = useState<FlashDirection | null>(null);
  const prevRef = useRef<number | null | undefined>(value);
  const mountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Mount: record the baseline, never flash on first paint.
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevRef.current = value;
      return;
    }
    const dir = flashDirection(prevRef.current, value);
    prevRef.current = value;
    if (dir === null) return;
    setFlash(dir);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFlash(null);
      timerRef.current = null;
    }, FLASH_MS);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const text =
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : format
        ? format(value)
        : String(value);
  const flashClass =
    flash === "up" ? FLASH_UP_CLASS : flash === "down" ? FLASH_DOWN_CLASS : "";
  const combined = [className, flashClass].filter(Boolean).join(" ");

  return (
    <span data-testid={testId} className={combined || undefined}>
      {text}
    </span>
  );
}
