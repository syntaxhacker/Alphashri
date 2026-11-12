import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIGridProps, UIGridColProps } from "../types";

const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

const GRID_KNOWN = [
  "children", "className", "style", "id", "data-testid", "gutter", "columns", "grow",
] as const;

export function GridCol(props: UIGridColProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "span", "offset", "order",
  ] as const);

  const span = known.span;
  const size = span != null && span !== "auto" && span !== "content" ? (span as number) : undefined;
  const pct = size != null ? `${(size / 12) * 100}%` : undefined;

  return (
    <div
      id={known.id}
      className={cn(known.className)}
      style={{
        ...(known.style as Record<string, unknown> | undefined),
        ...(size != null ? { flexBasis: pct, maxWidth: pct } : {}),
        ...(known.offset != null ? { marginLeft: `${(Number(known.offset) / 12) * 100}%` } : {}),
        ...(known.order != null ? { order: known.order } : {}),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}

export function Grid(props: UIGridProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, GRID_KNOWN);

  return (
    <div
      id={known.id}
      className={cn(known.className)}
      style={{
        display: "grid",
        ...(known.gutter != null ? { gap: sp(known.gutter) } : {}),
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
