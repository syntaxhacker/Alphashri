import { cn } from "../cn";
import * as palette from "../palette";
import type { UISkeletonProps } from "../types";

function radiusValue(radius: UISkeletonProps["radius"] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" };
  return m[radius] ?? undefined;
}

export function Skeleton({
  h,
  w,
  circle,
  radius,
  animate = true,
  visible = true,
  children,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UISkeletonProps) {
  if (!visible) return <>{children}</>;

  const hh = h == null ? undefined : typeof h === "number" ? `${h}px` : h;
  const ww = w == null ? undefined : typeof w === "number" ? `${w}px` : w;
  const br = radiusValue(radius);

  return (
    <div
      data-testid={testId}
      id={id}
      className={cn("inline-block", animate ? "animate-pulse" : undefined, circle ? "rounded-full" : br ? undefined : "rounded-fin", className)}
      style={{ height: hh, width: ww, borderRadius: br, backgroundColor: palette.BORDER, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
