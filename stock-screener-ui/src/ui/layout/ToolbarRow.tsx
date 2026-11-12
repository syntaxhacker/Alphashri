import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { JSX } from "solid-js";

export interface ToolbarRowProps {
  children?: JSX.Element;
  className?: string;
  style?: JSX.CSSProperties;
  id?: string;
  "data-testid"?: string;
  /** Gap in px (default 8). */
  gap?: number;
  justify?: "flex-start" | "center" | "flex-end" | "space-between";
  /** Allow wrapping (default true). */
  wrap?: boolean;
  /** Hide overflow (default false). */
  clip?: boolean;
}

/**
 * Enforced-alignment row for toolbars, filters, and any horizontal cluster of
 * controls. Guarantees `align-items: center` + an explicit gap so controls are
 * never vertically stretched or misaligned by a taller sibling.
 */
export function ToolbarRow(props: ToolbarRowProps) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "gap", "justify", "wrap", "clip",
  ] as const);

  return (
    <div
      id={known.id}
      className={cn(
        "flex items-center min-w-0",
        known.wrap !== false ? "flex-wrap" : "flex-nowrap",
        known.clip ? "overflow-hidden" : undefined,
        known.className,
      )}
      style={{
        justifyContent: known.justify ?? "flex-start",
        gap: `${known.gap ?? 8}px`,
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}
