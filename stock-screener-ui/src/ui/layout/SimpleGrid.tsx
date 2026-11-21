import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISimpleGridProps } from "../types";
import { sp } from "./spacing";

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
        "grid-template-columns": `repeat(${n}, minmax(0, 1fr))`,
        ...(known.spacing != null ? { gap: sp(known.spacing) } : {}),
        ...(known.verticalSpacing != null ? { "row-gap": sp(known.verticalSpacing) } : {}),
        ...(known.style as Record<string, unknown> | undefined),
      }}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}
