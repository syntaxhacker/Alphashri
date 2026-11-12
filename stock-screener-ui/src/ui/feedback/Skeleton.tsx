import { splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UISkeletonProps } from "../types";

function radiusValue(radius: UISkeletonProps["radius"] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" };
  return m[radius] ?? undefined;
}

export function Skeleton(props: UISkeletonProps) {
  const [known, _rest] = splitProps(props, [
    "h",
    "w",
    "circle",
    "radius",
    "animate",
    "visible",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  if (!known.visible) return <>{known.children}</>;

  const hh = known.h == null ? undefined : typeof known.h === "number" ? `${known.h}px` : known.h;
  const ww = known.w == null ? undefined : typeof known.w === "number" ? `${known.w}px` : known.w;
  const br = radiusValue(known.radius);

  return (
    <div
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn(
        "inline-block",
        known.animate ? "animate-pulse" : undefined,
        known.circle ? "rounded-full" : br ? undefined : "rounded-fin",
        known.className,
      )}
      style={{ height: hh, width: ww, borderRadius: br, backgroundColor: palette.BORDER, ...known.style }}
    >
      {known.children}
    </div>
  );
}
