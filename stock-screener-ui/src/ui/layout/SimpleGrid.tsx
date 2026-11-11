import { cn } from "../cn";
import type { CSSProperties } from "react";
import type { UISimpleGridProps } from "../types";

const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

export function SimpleGrid({ children, className, style, id, "data-testid": testId, cols, spacing, verticalSpacing, type, ...rest }: UISimpleGridProps & Record<string, unknown>) {
  void type;
  const n = typeof cols === "number" ? cols : 1;
  const styleObj: CSSProperties = {
    ...style,
    display: "grid",
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    ...(spacing != null && { gap: sp(spacing) }),
    ...(verticalSpacing != null && { rowGap: sp(verticalSpacing) }),
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
