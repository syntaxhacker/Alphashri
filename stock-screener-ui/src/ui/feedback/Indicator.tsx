import { splitProps } from "solid-js";
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

export function Indicator(props: UIIndicatorProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "color",
    "size",
    "offset",
    "disabled",
    "processing",
    "position",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  if (known.disabled) return <>{known.children}</>;

  const col = resolveColor(known.color);
  const dotSize = known.size ?? 8;
  const anchor = ANCHOR[known.position ?? "top-end"] ?? ANCHOR["top-end"];
  const transform = known.offset != null ? `translate(${known.offset}px, ${-known.offset}px)` : undefined;

  return (
    <span
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn("relative inline-block shrink-0", known.className)}
      style={known.style}
    >
      {known.children}
      <span
        className="absolute rounded-full flex items-center justify-center shrink-0"
        style={{
          ...anchor,
          width: dotSize,
          height: dotSize,
          backgroundColor: col,
          transform,
          ...(known.label != null
            ? { color: palette.BG, fontSize: Math.max(6, dotSize * 0.5), fontWeight: 600 }
            : {}),
        }}
      >
        {known.label != null ? <span style={{ position: "relative", zIndex: 1 }}>{known.label}</span> : null}
        {known.processing && (
          <span
            className="animate-ping border shrink-0 absolute inset-0 rounded-full"
            style={{ borderColor: col, opacity: 0.5, animationDuration: "1.2s" }}
          />
        )}
      </span>
    </span>
  );
}
