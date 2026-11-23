import { Show, splitProps } from "solid-js";
import { badgeTone, componentTokenVar, isCustomColor } from "../componentTokens";
import { cn } from "../cn";
import * as palette from "../palette";
import { typeSize, type TypeRole } from "../typography";
import { pickTextColor } from "@/utils/contrast";
import type { UIBadgeProps } from "../types";

/**
 * Badge = a status label, never a control. It is deliberately smaller than a
 * Chip (16px vs 20px), shares the 4px radius, and carries no pointer cursor or
 * hover fill so it can never be mistaken for something clickable.
 * `variant="dot"` drops the pill chrome entirely — a dot plus inline text.
 */

/**
 * Tone colours come from the `--ui-badge-*` component-token tier, which aliases
 * the semantic tokens. One token carries text, outline, dot and the inverted
 * fill: the old file kept a hex map and a semantic map for the same value.
 */
const toneMain = (color: UIBadgeProps["color"]) => componentTokenVar(`ui-badge-${badgeTone(color)}-main`);
const toneWash = (color: UIBadgeProps["color"]) => componentTokenVar(`ui-badge-${badgeTone(color)}-wash`);
const FILLED_INK = componentTokenVar("ui-badge-filled-ink");

function resolveColor(color: UIBadgeProps["color"]): string {
  if (isCustomColor(color)) return color;
  return toneMain(color);
}

type BadgeBox = { h: number; fontRole: TypeRole; px: number };

const BADGE_BOX: Record<string, BadgeBox> = {
  xs: { h: 14, fontRole: "micro", px: 4 },
  sm: { h: 16, fontRole: "micro", px: 5 },
  md: { h: 18, fontRole: "micro", px: 6 },
  lg: { h: 20, fontRole: "micro", px: 7 },
  xl: { h: 22, fontRole: "micro", px: 8 },
};

function badgeBox(size: UIBadgeProps["size"]): BadgeBox {
  return BADGE_BOX[String(size)] ?? BADGE_BOX.sm;
}

function radiusValue(radius: UIBadgeProps["radius"] | undefined): string {
  if (radius == null) return "4px";
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "2px", sm: "4px", md: "4px", lg: "6px", xl: "8px" };
  return m[radius] ?? "4px";
}

const DOT_SIZE = 5;

export function Badge(props: UIBadgeProps) {
  const [known, _rest] = splitProps(props, [
    "children",
    "leftSection",
    "rightSection",
    "className",
    "style",
    "data-testid",
    "id",
    "variant",
    "color",
    "size",
    "radius",
    "fullWidth",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
    "title",
  ]);

  const main = resolveColor(known.color);
  // Filled badges invert the same tone: text, outline, dot and fill share one
  // component token. A raw caller colour has no token pairing, so its ink still
  // goes through the contrast helper.
  const fill = main;
  const filledInk = (): string =>
    isCustomColor(known.color) ? pickTextColor(fill, palette.TEXT, palette.BG) : FILLED_INK;
  const wash = (): string =>
    isCustomColor(known.color) ? palette.alpha(fill, 0.12) : toneWash(known.color);
  const isFilled = known.variant === "filled" || known.variant === "white";
  const isOutline = known.variant === "outline";
  const isDot = known.variant === "dot";
  const box = badgeBox(known.size);

  const shape = (): Record<string, string> => {
    if (isDot) {
      return {
        height: `${box.h}px`,
        "border-radius": "0px",
        "border-width": "0px",
        "border-style": "none",
        "background-color": "transparent",
        "font-size": `${typeSize(box.fontRole)}px`,
        "font-weight": "600",
        "line-height": "1",
        "padding-left": "0px",
        "padding-right": "0px",
        cursor: "default",
      };
    }
    return {
      height: `${box.h}px`,
      "border-radius": radiusValue(known.radius),
      // Longhands: a `var()` inside the `border` shorthand is mis-parsed by
      // happy-dom (it lands in borderWidth). Same paint in the browser.
      ...(isOutline
        ? { "border-width": "1px", "border-style": "solid", "border-color": main }
        : { border: "none" }),
      "background-color": isFilled ? fill : isOutline ? "transparent" : wash(),
      "font-size": `${typeSize(box.fontRole)}px`,
      "font-weight": "600",
      "line-height": "1",
      "padding-left": `${box.px}px`,
      "padding-right": `${box.px}px`,
      cursor: "default",
    };
  };

  return (
    <span
      data-testid={known["data-testid"]}
      id={known.id}
      title={known.title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-mono uppercase select-none tracking-[0.04em]",
        known.fullWidth ? "w-full" : "shrink-0",
        known.className,
      )}
      style={{ ...shape(), color: isFilled ? filledInk() : main, ...known.style }}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
    >
      <Show when={isDot}>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full"
          style={{ width: `${DOT_SIZE}px`, height: `${DOT_SIZE}px`, "background-color": main }}
        />
      </Show>
      <Show when={!isDot && known.leftSection != null}>
        <span className="shrink-0">{known.leftSection}</span>
      </Show>
      <span>{known.children}</span>
      <Show when={!isDot && known.rightSection != null}>
        <span className="shrink-0">{known.rightSection}</span>
      </Show>
    </span>
  );
}
