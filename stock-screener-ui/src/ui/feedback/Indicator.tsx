import { cn } from "../cn";
import * as palette from "../palette";
import type { UIIndicatorProps } from "../types";

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

function resolveColor(color: UIIndicatorProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

const ANCHOR: Record<string, { top?: number; right?: number; bottom?: number; left?: number }> = {
  "top-start": { top: 0, left: 0 },
  "bottom-start": { bottom: 0, left: 0 },
  "bottom-end": { bottom: 0, right: 0 },
  "top-end": { top: 0, right: 0 },
};

export function Indicator({
  label,
  color,
  size,
  offset,
  disabled,
  processing,
  position = "top-end",
  children,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UIIndicatorProps) {
  if (disabled) return <>{children}</>;

  const col = resolveColor(color);
  const dotSize = size ?? 8;
  const anchor = ANCHOR[position] ?? ANCHOR["top-end"];
  const transform = offset != null ? `translate(${offset}px, ${-offset}px)` : undefined;

  return (
    <span
      data-testid={testId}
      id={id}
      className={cn("relative inline-block shrink-0", className)}
      style={style}
      {...rest}
    >
      {children}
      <span
        className="absolute rounded-full flex items-center justify-center shrink-0"
        style={{
          ...anchor,
          width: dotSize,
          height: dotSize,
          backgroundColor: col,
          transform,
          ...(label != null ? { color: palette.BG, fontSize: Math.max(6, dotSize * 0.5), fontWeight: 600 } : {}),
        }}
      >
        {label != null ? <span style={{ position: "relative", zIndex: 1 }}>{label}</span> : null}
        {processing && (
          <span
            className="animate-ping border shrink-0 absolute inset-0 rounded-full"
            style={{ borderColor: col, opacity: 0.5, animationDuration: "1.2s" }}
          />
        )}
      </span>
    </span>
  );
}
