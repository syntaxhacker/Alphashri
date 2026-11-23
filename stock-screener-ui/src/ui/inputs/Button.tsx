import { createMemo, splitProps } from "solid-js";
import { buttonTone, type UiTone } from "../componentTokens";
import { cn } from "../cn";
import type { UIButtonProps, UISize } from "../types";

/**
 * The button family is distinguished by *treatment*, not by hue: a solid fill,
 * an accent wash, a hairline, a text-only ghost and a neutral filled form
 * button are five different objects. Height belongs to the size step, so no
 * variant can be taller than another at the same `size`.
 *
 * Colours now come from the `--ui-button-*` component-token tier, not from
 * palette values re-derived here. Class literals are still spelled out because
 * Tailwind only emits utilities it can see in source — a runtime-interpolated
 * token name would silently drop every non-primary tone.
 */

type Token = UiTone;

interface Accent {
  solid: string;
  /** Foreground on the solid fill — near-black clears contrast on every accent. */
  onSolid: string;
  text: string;
  border: string;
  /** 12% wash, used as the `light` fill. */
  tint: string;
  /** Accent wash on hover of a tinted control. */
  tintHover: string;
  /** 12% accent wash, used to reveal a `subtle` control on hover. */
  tintSoft: string;
}

/** The page ink on any solid accent fill — one shared component token. */
const SOLID_INK = "text-[var(--ui-button-solid-ink)]";

/** Neutral surfaces/ink for untinted variants — shared component tokens. */
const NEUTRAL = {
  border: "border-[var(--ui-button-neutral-border)]",
  text: "text-[var(--ui-button-neutral-text)]",
  muted: "text-[var(--ui-button-neutral-muted)]",
  surface: "bg-[var(--ui-button-neutral-surface)]",
  surfaceAlt: "bg-[var(--ui-button-neutral-surface-alt)]",
  hoverSurface: "enabled:hover:bg-[var(--ui-button-neutral-surface-alt)]",
  hoverSurfaceBase: "enabled:hover:bg-[var(--ui-button-neutral-surface)]",
  hoverText: "enabled:hover:text-[var(--ui-button-neutral-text)]",
};

const ACCENTS: Record<Token, Accent> = {
  primary: {
    solid: "bg-[var(--ui-button-primary-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-primary-text)]",
    border: "border-[var(--ui-button-primary-text)]",
    tint: "bg-[var(--ui-button-primary-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-primary-wash-hover)]",
    // Legacy semantic utility kept as a compatibility alias (an external
    // ActionIcon test keys off it); it resolves to the same semantic anchor.
    tintSoft: "enabled:hover:bg-[var(--ui-button-primary-wash)] enabled:hover:bg-fin-primary/12",
  },
  positive: {
    solid: "bg-[var(--ui-button-positive-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-positive-text)]",
    border: "border-[var(--ui-button-positive-text)]",
    tint: "bg-[var(--ui-button-positive-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-positive-wash-hover)]",
    tintSoft: "enabled:hover:bg-[var(--ui-button-positive-wash)]",
  },
  negative: {
    solid: "bg-[var(--ui-button-negative-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-negative-text)]",
    border: "border-[var(--ui-button-negative-text)]",
    tint: "bg-[var(--ui-button-negative-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-negative-wash-hover)]",
    tintSoft: "enabled:hover:bg-[var(--ui-button-negative-wash)]",
  },
  warning: {
    solid: "bg-[var(--ui-button-warning-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-warning-text)]",
    border: "border-[var(--ui-button-warning-text)]",
    tint: "bg-[var(--ui-button-warning-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-warning-wash-hover)]",
    tintSoft: "enabled:hover:bg-[var(--ui-button-warning-wash)]",
  },
  info: {
    solid: "bg-[var(--ui-button-info-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-info-text)]",
    border: "border-[var(--ui-button-info-text)]",
    tint: "bg-[var(--ui-button-info-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-info-wash-hover)]",
    tintSoft: "enabled:hover:bg-[var(--ui-button-info-wash)]",
  },
  muted: {
    solid: "bg-[var(--ui-button-muted-bg)]",
    onSolid: SOLID_INK,
    text: "text-[var(--ui-button-muted-text)]",
    border: "border-[var(--ui-button-muted-text)]",
    tint: "bg-[var(--ui-button-muted-wash)]",
    tintHover: "enabled:hover:bg-[var(--ui-button-muted-wash-hover)]",
    tintSoft: "enabled:hover:bg-[var(--ui-button-muted-wash)]",
  },
};

/**
 * Height map — one step per `size`, shared by every variant and by ActionIcon:
 * xs 24 · sm 30 · md 34 · lg 38 · xl 42. `sm` is the default (modal footers,
 * form rows); `xs` is the dense table/toolbar step.
 */
const SIZE_CLASSES: Record<UISize, string> = {
  xs: "h-[24px] px-2 text-xs gap-1",
  sm: "h-[30px] px-3 text-sm gap-1.5",
  md: "h-[34px] px-3.5 text-sm gap-1.5",
  lg: "h-[38px] px-4 text-base gap-2",
  xl: "h-[42px] px-5 text-base gap-2",
};

/**
 * `transparent` is the escape hatch for bespoke inline controls (e.g. the tape
 * header's pill, which carries its own padding/metrics in `style`). It takes the
 * type step but no box, so it keeps the caller's line height.
 */
const SIZE_TEXT_ONLY: Record<UISize, string> = {
  xs: "text-xs gap-1",
  sm: "text-sm gap-1.5",
  md: "text-sm gap-1.5",
  lg: "text-base gap-2",
  xl: "text-base gap-2",
};

function sizeClass(size: UISize, boxed: boolean): string {
  return boxed ? SIZE_CLASSES[size] : SIZE_TEXT_ONLY[size];
}

function radiusClass(radius?: UIButtonProps["radius"]): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return undefined; // applied via inline style
  switch (radius) {
    case "xs":
      return "rounded-[2px]";
    case "sm":
      return "rounded-[4px]";
    case "md":
      return "rounded-[6px]";
    case "lg":
      return "rounded-lg";
    case "xl":
      return "rounded-xl";
    default:
      return "rounded-[6px]";
  }
}

/**
 * `color` recolours the *whole* treatment (fill, border and text), not just the
 * label. Only an explicit `color` does that — an unset color keeps `outline`
 * and `default` on the neutral hairline so a page does not turn all-amber.
 */
function variantClass(variant: UIButtonProps["variant"], accent: Accent, tint: boolean): string {
  switch (variant) {
    case "filled":
      // Primary action: solid fill, no visible border, heavier weight.
      return cn(
        "border border-transparent font-semibold",
        accent.solid,
        accent.onSolid,
        "enabled:hover:brightness-110 enabled:active:brightness-95",
      );
    case "light":
      // Secondary action: accent wash, no border.
      return cn("border border-transparent font-medium", accent.tint, accent.text, accent.tintHover);
    case "outline":
      // Tertiary / destructive-confirm: hairline, no fill.
      return cn(
        "border bg-transparent",
        tint ? accent.border : NEUTRAL.border,
        tint ? accent.text : NEUTRAL.text,
        NEUTRAL.hoverSurface,
      );
    case "subtle":
      // Quads / icon-adjacent: invisible until hovered, then an accent wash.
      return cn(
        "border border-transparent bg-transparent",
        tint ? accent.text : NEUTRAL.muted,
        NEUTRAL.hoverText,
        accent.tintSoft,
      );
    case "default":
      // Form button: neutral filled + hairline, reads as a field, not a CTA.
      return cn(
        "border",
        NEUTRAL.surfaceAlt,
        tint ? accent.border : NEUTRAL.border,
        tint ? accent.text : NEUTRAL.text,
        NEUTRAL.hoverSurfaceBase,
      );
    case "white":
      return cn("border", NEUTRAL.border, NEUTRAL.surface, NEUTRAL.text, NEUTRAL.hoverSurface);
    case "transparent":
      return cn("border border-transparent bg-transparent", accent.text, NEUTRAL.hoverSurface, NEUTRAL.hoverText);
    case undefined:
      // No `variant` prop keeps the historical primary action (19 call sites).
      return cn(
        "border border-transparent font-semibold",
        accent.solid,
        accent.onSolid,
        "enabled:hover:brightness-110 enabled:active:brightness-95",
      );
    default:
      return cn("border border-transparent bg-transparent", accent.text, NEUTRAL.hoverSurface, NEUTRAL.hoverText);
  }
}

const Spinner = () => (
  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
);

export function Button(props: UIButtonProps) {
  const [known, _rest] = splitProps(props, [
    "children",
    "leftSection",
    "rightSection",
    "className",
    "style",
    "onClick",
    "data-testid",
    "id",
    "variant",
    "color",
    "size",
    "radius",
    "fullWidth",
    "disabled",
    "loading",
    "type",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  const accent = createMemo(() => ACCENTS[buttonTone(known.color)]);
  const tinted = createMemo(() => known.color != null);
  const disabledOrLoading = () => known.disabled || known.loading;

  return (
    <button
      type={known.type ?? "button"}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-[0.45]",
        known.radius == null ? "rounded-[6px]" : undefined,
        variantClass(known.variant, accent(), tinted()),
        sizeClass(known.size ?? "sm", known.variant !== "transparent"),
        radiusClass(known.radius),
        known.fullWidth && "w-full",
        known.className,
      )}
      style={{ ...(typeof known.radius === "number" ? { "border-radius": `${known.radius}px` } : {}), ...known.style }}
      disabled={disabledOrLoading()}
      data-loading={known.loading || undefined}
      aria-busy={known.loading || undefined}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
      {..._rest}
    >
      {known.leftSection || known.loading ? (
        <span className="flex-shrink-0">{known.leftSection ?? <Spinner />}</span>
      ) : null}
      {known.children}
      {known.rightSection ? <span className="flex-shrink-0">{known.rightSection}</span> : null}
    </button>
  );
}
