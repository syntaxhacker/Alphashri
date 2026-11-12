import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISimpleGridProps } from "../types";

const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return (m[v as string] ?? v) as string;
};

export function SimpleGrid(props: UISimpleGridProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, [
    "children", "className", "style", "id", "data-testid", "cols", "spacing", "verticalSpacing", "type",
  ] as const);
  void known.type;

  const n = typeof known.cols === "number" ? known.cols : 1;

  return (
    <div
      id={known.id}
      className={cn(known.className)}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
        ...(known.spacing != null ? { gap: sp(known.spacing) } : {}),
        ...(known.verticalSpacing != null ? { rowGap: sp(known.verticalSpacing) } : {}),
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}
