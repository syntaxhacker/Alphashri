import { Show, splitProps } from "solid-js";
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

  if (known.visible === false) return <>{known.children}</>;

  const hh = known.h == null ? "16px" : typeof known.h === "number" ? `${known.h}px` : known.h;
  const ww = known.w == null ? "100%" : typeof known.w === "number" ? `${known.w}px` : known.w;
  const br = radiusValue(known.radius);

  return (
    <div
      aria-hidden="true"
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn(
        "block relative overflow-hidden",
        known.circle ? "rounded-full" : br ? undefined : "rounded-fin",
        known.className,
      )}
      style={{
        height: hh,
        width: ww,
        "border-radius": br,
        "background-color": palette.SURFACE_ALT,
        ...known.style,
      }}
    >
      <Show when={known.animate !== false}>
        <span
          data-fin-motion="skeleton"
          aria-hidden="true"
          className="pointer-events-none block absolute"
          style={{
            inset: "0",
            "background-image": `linear-gradient(90deg, transparent 0%, ${palette.alpha(palette.TEXT, 0.07)} 50%, transparent 100%)`,
            animation: "fin-skeleton-shimmer 1.6s ease-in-out infinite",
          }}
        />
      </Show>
    </div>
  );
}
