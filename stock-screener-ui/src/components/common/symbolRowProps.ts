import type { JSX } from "solid-js";

/**
 * Keyboard/pointer activation props for a clickable "symbol row" — the pattern
 * repeated by the report strips, the move panels and the dashboard cards:
 * the row becomes a real button target only when an open handler is supplied,
 * and Enter/Space activate it (Space is prevented so the page never scrolls).
 */
export type SymbolOpenHandler = (symbol: string) => void;

export interface SymbolRowActivationProps {
  role?: "button";
  tabIndex?: number;
  onClick?: () => void;
  onKeyDown?: JSX.EventHandler<HTMLElement, KeyboardEvent>;
}

/** Activation props for one row. No handler → the row stays inert. */
export function symbolRowProps(
  onOpenSymbol: SymbolOpenHandler | undefined,
  symbol: string,
): SymbolRowActivationProps {
  if (!onOpenSymbol) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick: () => onOpenSymbol(symbol),
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenSymbol(symbol);
      }
    },
  };
}

/** Cursor for a symbol row: clickable only when an open handler exists. */
export function symbolRowCursor(onOpenSymbol: SymbolOpenHandler | undefined): "pointer" | "default" {
  return onOpenSymbol ? "pointer" : "default";
}
