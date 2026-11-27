import { Show, splitProps } from "solid-js";
import { alertTone, componentTokenVar, isCustomColor, TONE_ANCHORS } from "../componentTokens";
import { cn } from "../cn";
import * as palette from "../palette";
import { pickTextColor } from "@/utils/contrast";
import type { UIAlertProps } from "../types";

/* Painted colours come from the `--ui-alert-*` tier; the raw anchors in
 * TONE_ANCHORS are used only to feed the contrast helper for filled inks. */
const toneMain = (color: UIAlertProps["color"]) => componentTokenVar(`ui-alert-${alertTone(color)}-main`);
const toneWash = (color: UIAlertProps["color"]) => componentTokenVar(`ui-alert-${alertTone(color)}-wash`);
const toneWashBorder = (color: UIAlertProps["color"]) =>
  componentTokenVar(`ui-alert-${alertTone(color)}-wash-border`);

function resolveColor(color: UIAlertProps["color"]): string {
  if (isCustomColor(color)) return color;
  return toneMain(color);
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
    "action",
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
  const custom = isCustomColor(known.color);
  const tone = alertTone(known.color);
  const isFilled = known.variant === "filled";
  const isOutline = known.variant === "outline";
  const isTransparent = known.variant === "transparent";
  const br = radiusValue(known.radius);
  const rgb = custom ? hexRgb(main) : undefined;

  let bg: string | undefined;
  let borderColor: string | undefined;
  let textColor: string | undefined;
  if (isFilled) {
    bg = main;
    borderColor = main;
    // A solid severity fill is only as readable as its ink; never force the
    // page token onto a tone that resolves lighter than the text anchor. The
    // helper needs a parseable colour, so named tones pass their raw anchor.
    textColor = pickTextColor(custom ? main : TONE_ANCHORS[tone], palette.TEXT, palette.BG);
  } else if (isOutline) {
    bg = "transparent";
    borderColor = main;
    textColor = main;
  } else if (isTransparent) {
    bg = "transparent";
    textColor = main;
  } else {
    bg = custom ? `rgba(${rgb}, 0.10)` : toneWash(known.color);
    borderColor = custom ? `rgba(${rgb}, 0.35)` : toneWashBorder(known.color);
    textColor = main;
  }

  return (
    <div
      role="alert"
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn(
        "flex flex-wrap items-start gap-3 p-3 text-sm leading-snug",
        br ? undefined : "rounded-fin",
        known.className,
      )}
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
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Show when={known.title != null}>
          <div className="font-semibold">{known.title}</div>
        </Show>
        <div>{known.children}</div>
      </div>
      <Show when={known.action != null}>
        <div className={cn("shrink-0", known.children != null ? "self-start" : "self-center")}>
          {known.action}
        </div>
      </Show>
      <Show when={known.withCloseButton}>
        <button
          type="button"
          aria-label="Close"
          onClick={() => known.onClose?.()}
          className="ml-auto shrink-0 rounded p-1 text-fin-text-muted hover:bg-fin-surface-alt"
          style={{ color: textColor }}
        >
          ×
        </button>
      </Show>
    </div>
  );
}
