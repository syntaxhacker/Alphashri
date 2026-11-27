import { splitProps, Show } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import { TYPE_SCALE, typeSize } from "../typography";
import type { UIIndicatorProps } from "../types";

const SCALE_STEPS = Object.values(TYPE_SCALE).map((s) => s.size);

/** Decorative dot label: proportional to the dot, snapped to the shared ladder. */
function snapTypeSize(px: number): number {
  const nearest = SCALE_STEPS.reduce(
    (best, step) => (Math.abs(step - px) <= Math.abs(best - px) ? step : best),
    SCALE_STEPS[0],
  );
  return Math.max(typeSize("micro"), nearest);
}

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

// Keys are the public `position` vocabulary; camelCase keys left the dot
// unanchored, so it fell to its static position below the wrapped control.
// Values stay px strings — Solid's setProperty drops unitless non-zero numbers.
const ANCHOR: Record<string, { top?: string; right?: string; bottom?: string; left?: string }> = {
  "top-start": { top: "0px", left: "0px" },
  "bottom-start": { bottom: "0px", left: "0px" },
  "bottom-end": { bottom: "0px", right: "0px" },
  "top-end": { top: "0px", right: "0px" },
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
        const hasLabel = known.label != null;
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
                // A multi-character label cannot fit the 8px dot: let the box
                // shrink-to-fit so the text stays on the coloured fill instead
                // of spilling out as black-on-dark outside the control.
                width: hasLabel ? "auto" : `${dotSize}px`,
                "min-width": `${dotSize}px`,
                ...(hasLabel && known.label!.length > 1 ? { padding: "0 4px" } : {}),
                height: `${dotSize}px`,
                "background-color": col,
                transform,
                ...(hasLabel
                  ? { color: palette.BG, "font-size": `${snapTypeSize(dotSize * 0.5)}px`, "font-weight": 600 }
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
