import { cn } from "../cn";
import type { CSSProperties } from "react";
import type { UIGridProps, UIGridColProps } from "../types";

const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

export function GridCol({ children, className, style, id, "data-testid": testId, span, offset, order, ...rest }: UIGridColProps & Record<string, unknown>) {
  const size = span != null && span !== "auto" && span !== "content" ? span : undefined;
  const pct = size != null ? `${(size / 12) * 100}%` : undefined;
  const styleObj: CSSProperties = {
    ...style,
    ...(size != null && { flexBasis: pct, maxWidth: pct }),
    ...(offset != null && { marginLeft: `${(Number(offset) / 12) * 100}%` }),
    ...(order != null && { order }),
  };
  return (
    <div
      id={id}
      className={cn(className)}
      style={styleObj}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Grid({ children, className, style, id, "data-testid": testId, gutter, columns, grow, ...rest }: UIGridProps & Record<string, unknown>) {
  void columns; void grow;
  const styleObj: CSSProperties = {
    ...style,
    display: "grid",
    ...(gutter != null && { gap: sp(gutter) }),
  };
  return (
    <div
      id={id}
      className={cn(className)}
      style={styleObj}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}
Grid.Col = GridCol;
