import { useEffect, useRef } from "react";

export type DeskChartTimeframe = "1m" | "5m" | "15m";

export interface DeskHotkeyCallbacks {
  /** `D` — toggle desk/research. */
  onToggleDesk?: () => void;
  /** `F` — chart fullscreen. */
  onChartFullscreen?: () => void;
  /** `E` — expand the last-hovered panel (plan reasons fallback). */
  onExpandHovered?: () => void;
  /** `V` — visuals grid (stub). */
  onVisualsGrid?: () => void;
  /** `Esc` — close the top modal. */
  onClose?: () => void;
  /** `1` / `5` / `1` then `5` — chart timeframe. */
  onTimeframe?: (tf: DeskChartTimeframe) => void;
}

/** `1` followed by `5` within this long reads as `15m`, not `1m` then `5m`. */
export const TF_SEQUENCE_MS = 600;

/**
 * True when a keydown target is a text-entry surface — hotkeys never fire
 * from inside inputs, textareas, selects, or contenteditable regions.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || target === undefined) return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Desk hotkeys for the Nifty report. Single window `keydown` listener,
 * callbacks via ref (never rebinds), removed on unmount. Returns nothing.
 */
export function useDeskHotkeys(callbacks: DeskHotkeyCallbacks): void {
  const ref = useRef(callbacks);
  ref.current = callbacks;

  useEffect(() => {
    let lastKey = "";
    let lastAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const c = ref.current;
      const key = event.key;
      const lower = key.toLowerCase();
      if (lower === "d") {
        c.onToggleDesk?.();
      } else if (lower === "f") {
        c.onChartFullscreen?.();
      } else if (lower === "e") {
        c.onExpandHovered?.();
      } else if (lower === "v") {
        c.onVisualsGrid?.();
      } else if (lower === "escape") {
        c.onClose?.();
      } else if (key === "1") {
        c.onTimeframe?.("1m");
      } else if (key === "5") {
        const now = Date.now();
        if (lastKey === "1" && now - lastAt < TF_SEQUENCE_MS) {
          c.onTimeframe?.("15m");
        } else {
          c.onTimeframe?.("5m");
        }
      } else {
        return;
      }
      lastKey = key;
      lastAt = Date.now();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
