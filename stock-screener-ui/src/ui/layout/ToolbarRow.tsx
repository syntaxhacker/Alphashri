import { cn } from "../cn";
import type { CSSProperties, ReactNode } from "react";

export interface ToolbarRowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
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
export function ToolbarRow({
  children,
  className,
  style,
  id,
  "data-testid": testId,
  gap = 8,
  justify = "flex-start",
  wrap = true,
  clip = false,
}: ToolbarRowProps) {
  return (
    <div
      id={id}
      className={cn("flex items-center min-w-0", wrap ? "flex-wrap" : "flex-nowrap", clip ? "overflow-hidden" : undefined, className)}
      style={{ justifyContent: justify, gap: `${gap}px`, ...style }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
