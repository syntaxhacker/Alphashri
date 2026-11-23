import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIGridProps, UIGridColProps } from "../types";
import { sp } from "./spacing";

export interface GridProps extends UIGridProps {
  /** Number of equal grid columns (default 12). */
  cols?: number;
  /** Gap between cells: number = px, or an 8pt token (xs/sm/md/lg/xl). */
  gap?: number | string;
  /** Number of equal explicit rows. */
  rows?: number;
  /** Direction auto-placed cells flow. */
  flow?: "row" | "col";
}

const GRID_KNOWN = [
  "children", "className", "style", "id", "data-testid", "gutter", "columns",
  "cols", "gap", "rows", "flow",
] as const;

export function GridCol(props: UIGridColProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "span", "offset", "order",
  ] as const);

  const span = known.span;
  const size = span != null && span !== "auto" && span !== "content" ? (span as number) : undefined;
  const offset = known.offset != null ? Math.max(0, Math.floor(Number(known.offset))) : undefined;

  return (
    <div
      id={known.id}
      className={cn(known.className)}
      style={{
        ...(known.style as Record<string, unknown> | undefined),
        ...(size != null
          ? {
              "grid-column": offset != null
                ? `${offset + 1} / span ${size}`
                : `span ${size} / span ${size}`,
            }
          : offset != null
            ? { "grid-column-start": offset + 1 }
            : {}),
        ...(known.order != null ? { order: known.order } : {}),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}

export function Grid(props: GridProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, GRID_KNOWN);

  const cols = known.cols ?? known.columns ?? 12;
  const gap = known.gap ?? known.gutter;

  return (
    <div
      id={known.id}
      className={cn(known.className)}
      style={{
        display: "grid",
        "grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`,
        ...(known.rows != null ? { "grid-template-rows": `repeat(${known.rows}, minmax(0, 1fr))` } : {}),
        ...(known.flow != null ? { "grid-auto-flow": known.flow === "col" ? "column" : "row" } : {}),
        ...(gap != null ? { gap: sp(gap) } : {}),
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}

Grid.Col = GridCol;
