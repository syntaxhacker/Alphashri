import { cn } from "../cn";
import * as palette from "../palette";
import type { UILoaderProps } from "../types";

const SIZE_PX: Record<string, string> = { xs: "16px", sm: "20px", md: "28px", lg: "36px", xl: "44px" };
const COLOR_MAIN: Record<string, string> = {
  primary: palette.PRIMARY,
  success: palette.POSITIVE_COLOR,
  error: palette.NEGATIVE_COLOR,
  danger: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  secondary: palette.TEXT_MUTED,
  default: palette.TEXT_MUTED,
};

function resolveSize(size: UILoaderProps["size"]): string | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return `${size}px`;
  if (typeof size === "string" && !isNaN(Number(size))) return `${Number(size)}px`;
  return SIZE_PX[size] ?? undefined;
}

function resolveColor(color: UILoaderProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

export function Loader({
  className,
  style,
  "data-testid": testId,
  id,
  size,
  color,
  type = "oval",
  ...rest
}: UILoaderProps) {
  const dim = resolveSize(size) ?? "28px";
  const col = resolveColor(color);

  return (
    <div
      role="progressbar"
      data-testid={testId}
      id={id}
      className={cn("inline-block shrink-0", className)}
      style={{
        width: dim,
        height: dim,
        color: col,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      {...rest}
    >
      {type === "bars" ? (
        <div className="flex w-full h-full items-end gap-1">
          {[0.6, 1.0, 0.75].map((fill, i) => (
            <div
              key={i}
              className="w-1.5 bg-current rounded-sm shrink-0 animate-pulse"
              style={{ height: `${Math.round(fill * 100)}%`, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      ) : type === "dots" ? (
        <div className="flex w-full h-full items-center justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-current rounded-full shrink-0 animate-pulse"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      ) : (
        <svg
          className="animate-spin shrink-0"
          style={{ width: "100%", height: "100%" }}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
