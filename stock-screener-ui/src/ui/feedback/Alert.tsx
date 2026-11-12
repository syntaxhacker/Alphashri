import { Show, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIAlertProps } from "../types";

const SEVERITY_MAIN: Record<string, string> = {
  success: palette.POSITIVE_COLOR,
  error: palette.NEGATIVE_COLOR,
  danger: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  primary: palette.INFO,
  secondary: palette.TEXT_MUTED,
};

function resolveColor(color: UIAlertProps["color"]): string {
  if (!color) return palette.INFO;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return SEVERITY_MAIN[color] ?? palette.INFO;
}

function hexRgb(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

function radiusValue(radius: UIAlertProps["radius"] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" };
  return m[radius] ?? undefined;
}

export function Alert(props: UIAlertProps) {
  const [known, _rest] = splitProps(props, [
    "icon",
    "title",
    "withCloseButton",
    "onClose",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
    "variant",
    "color",
    "radius",
  ]);

  const main = resolveColor(known.color);
  const isFilled = known.variant === "filled";
  const isOutline = known.variant === "outline";
  const br = radiusValue(known.radius);
  const rgb = hexRgb(main);

  let bg: string | undefined;
  let borderColor: string | undefined;
  let textColor: string | undefined;
  if (isFilled) {
    bg = main;
    borderColor = main;
    textColor = palette.BG;
  } else if (isOutline) {
    bg = "transparent";
    borderColor = main;
    textColor = main;
  } else {
    // light / default / transparent / standard: tinted surface
    bg = `rgba(${rgb}, 0.10)`;
    borderColor = `rgba(${rgb}, 0.35)`;
    textColor = main;
  }

  return (
    <div
      role="alert"
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn("flex items-start gap-3 p-3 text-sm leading-snug", br ? undefined : "rounded-fin", known.className)}
      style={{
        "border-radius": br,
        "background-color": bg,
        border: borderColor ? `1px solid ${borderColor}` : undefined,
        color: textColor,
        ...known.style,
      }}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
    >
      <Show when={known.icon != null}>
        <span className="shrink-0" aria-hidden="true">{known.icon}</span>
      </Show>
      <div className="flex flex-col gap-1" style={{ flex: 1, "min-width": 0 }}>
        <Show when={known.title != null}>
          <div className="font-semibold">{known.title}</div>
        </Show>
        <div>{known.children}</div>
      </div>
      <Show when={known.withCloseButton}>
        <button
          type="button"
          aria-label="Close"
          onClick={(e) => known.onClose?.(e)}
          className="ml-auto shrink-0 rounded p-1 text-fin-text-muted hover:bg-fin-surface-alt focus:outline-none"
          style={{ color: textColor }}
        >
          ×
        </button>
      </Show>
    </div>
  );
}
