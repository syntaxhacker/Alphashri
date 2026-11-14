import { splitProps, Show } from "solid-js";
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

// ANCHOR values are px strings — Solid's setProperty drops unitless non-zero numbers.
const ANCHOR: Record<string, { top?: string; right?: string; bottom?: string; left?: string }> = {
  topStart: { top: "0px", left: "0px" },
  bottomStart: { bottom: "0px", left: "0px" },
  bottomEnd: { bottom: "0px", right: "0px" },
  topEnd: { top: "0px", right: "0px" },
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

  return (
    <Show
      when={!known.disabled}
      fallback={
        // No dot when disabled, but the wrapper stays: dropping the testid too
        // made the component impossible to assert on in either state.
        <span
          data-testid={known["data-testid"]}
          id={known.id}
          className={cn("relative inline-block shrink-0", known.className)}
          style={known.style}
        >
          {known.children}
        </span>
      }
    >
      {(() => {
        const col = resolveColor(known.color);
        const dotSize = known.size ?? 8;
        const anchor = ANCHOR[known.position ?? "top-end"] ?? ANCHOR["top-end"];
        const transform =
          known.offset != null ? `translate(${known.offset}px, ${-known.offset}px)` : undefined;

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
                width: `${dotSize}px`,
                height: `${dotSize}px`,
                "background-color": col,
                transform,
                ...(known.label != null
                  ? { color: palette.BG, "font-size": `${Math.max(6, dotSize * 0.5)}px`, "font-weight": 600 }
                  : {}),
              }}
            >
              {known.label != null ? (
                <span style={{ position: "relative", "z-index": 1 }}>{known.label}</span>
              ) : null}
              {known.processing && (
                <span
                  className="animate-ping border shrink-0 absolute inset-0 rounded-full"
                  style={{ "border-color": col, opacity: 0.5, "animation-duration": "1.2s" }}
                />
              )}
            </span>
          </span>
        );
      })()}
    </Show>
  );
}
