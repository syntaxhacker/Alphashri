import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";
import { sp } from "./spacing";

export type RowAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type RowJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

const ALIGN: Record<RowAlign, string> = {
  start: "start",
  center: "center",
  end: "end",
  stretch: "stretch",
  baseline: "baseline",
};

const JUSTIFY: Record<RowJustify, string> = {
  start: "start",
  center: "center",
  end: "end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

export interface RowProps {
  children?: JSX.Element;
  className?: string;
  style?: JSX.CSSProperties;
  id?: string;
  "data-testid"?: string;
  /** Number of equal columns the row is divided into (default 12). */
  cols?: number;
  /** Gap between cells: number = px, or an 8pt token (xs/sm/md/lg/xl). */
  gap?: number | string;
  align?: RowAlign;
  justify?: RowJustify;
  /**
   * Wrapped (default) rows give overflowing spans new implicit rows via
   * `grid-auto-flow: row`. Unwrapped rows become a single content-sized band.
   */
  wrap?: boolean;
}

export function Row(props: RowProps) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "cols", "gap", "align", "justify", "wrap",
  ] as const);

  const cols = known.cols ?? 12;
  const wrap = known.wrap !== false;

  return (
    <div
      id={known.id}
      className={cn("w-full min-w-0", known.className)}
      style={{
        display: "grid",
        ...(wrap
          ? {
              "grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`,
              "grid-auto-flow": "row",
            }
          : {
              "grid-template-columns": "none",
              "grid-auto-flow": "column",
              "grid-auto-columns": "max-content",
            }),
        gap: sp(known.gap ?? 8) as string,
        "align-items": known.align ? ALIGN[known.align] : undefined,
        "justify-content": known.justify ? JUSTIFY[known.justify] : undefined,
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}
