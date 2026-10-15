import MuiBox from "@mui/material/Box";
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
    <MuiBox
      id={id}
      className={className}
      style={style}
      data-testid={testId}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        gap: `${gap}px`,
        flexWrap: wrap ? "wrap" : "nowrap",
        minWidth: 0,
        ...(clip && { overflow: "hidden" }),
      }}
    >
      {children}
    </MuiBox>
  );
}
