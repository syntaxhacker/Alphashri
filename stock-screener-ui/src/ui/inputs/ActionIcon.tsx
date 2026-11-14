import { createMemo, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIActionIconProps, UISize } from "../types";

/**
 * ActionIcon is an icon-only control, not a small Button: it is a square on the
 * same height scale, has no horizontal text padding, and its hover is a raised
 * rounded square (a neutral fill + hairline) rather than the accent wash a
 * `Button` paints across its full width.
 *
 * Class literals are spelled out — Tailwind only emits utilities it can see in
 * source, so a template-concatenated class silently never paints.
 */

type Token = "primary" | "positive" | "negative" | "warning" | "info" | "muted";

interface Accent {
  solid: string;
  onSolid: string;
  text: string;
  border: string;
  tint: string;
  tintHover: string;
}

const ACCENTS: Record<Token, Accent> = {
  primary: {
    solid: "bg-fin-primary",
    onSolid: "text-fin-bg",
    text: "text-fin-primary",
    border: "border-fin-primary",
    tint: "bg-fin-primary/12",
    tintHover: "enabled:hover:bg-fin-primary/20",
  },
  positive: {
    solid: "bg-fin-positive",
    onSolid: "text-fin-bg",
    text: "text-fin-positive",
    border: "border-fin-positive",
    tint: "bg-fin-positive/12",
    tintHover: "enabled:hover:bg-fin-positive/20",
  },
  negative: {
    solid: "bg-fin-negative",
    onSolid: "text-fin-bg",
    text: "text-fin-negative",
    border: "border-fin-negative",
    tint: "bg-fin-negative/12",
    tintHover: "enabled:hover:bg-fin-negative/20",
  },
  warning: {
    solid: "bg-fin-warning",
    onSolid: "text-fin-bg",
    text: "text-fin-warning",
    border: "border-fin-warning",
    tint: "bg-fin-warning/12",
    tintHover: "enabled:hover:bg-fin-warning/20",
  },
  info: {
    solid: "bg-fin-info",
    onSolid: "text-fin-bg",
    text: "text-fin-info",
    border: "border-fin-info",
    tint: "bg-fin-info/12",
    tintHover: "enabled:hover:bg-fin-info/20",
  },
  muted: {
    solid: "bg-fin-text-muted",
    onSolid: "text-fin-bg",
    text: "text-fin-text-muted",
    border: "border-fin-text-muted",
    tint: "bg-fin-text-muted/12",
    tintHover: "enabled:hover:bg-fin-text-muted/20",
  },
};

/**
 * Square size map, same steps as `Button`: xs 24 · sm 30 · md 34 · lg 38 · xl 42.
 * `xs` is the default because icon controls sit inside dense 24–28px bars.
 */
const SIZE_CLASSES: Record<UISize, string> = {
  xs: "w-[24px] h-[24px] text-xs",
  sm: "w-[30px] h-[30px] text-sm",
  md: "w-[34px] h-[34px] text-sm",
  lg: "w-[38px] h-[38px] text-base",
  xl: "w-[42px] h-[42px] text-base",
};

function tokenFor(color?: UIActionIconProps["color"]): Token {
  switch (String(color)) {
    case "success":
      return "positive";
    case "error":
    case "danger":
      return "negative";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "secondary":
      return "muted";
    default:
      return "primary";
  }
}

function radiusClass(radius?: UIActionIconProps["radius"]): string | undefined {
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

function sizeStyle(size?: UIActionIconProps["size"]): { width?: string; height?: string } | undefined {
  if (size == null || typeof size !== "number") return undefined;
  return { width: `${size}px`, height: `${size}px` };
}

/**
 * A numeric `size` carries its own square in the inline style, so the class map
 * only applies to named steps. `xs` is the default step for icon controls.
 */
function squareClasses(size?: UIActionIconProps["size"]): string {
  if (typeof size === "number") return "";
  // `size` also accepts an arbitrary CSS length; only named steps have classes.
  const step = size && size in SIZE_CLASSES ? (size as UISize) : "xs";
  return SIZE_CLASSES[step];
}

/**
 * Hover for every icon control: a raised rounded square, never a text-width tint.
 */
const SQUARE_HOVER = "enabled:hover:bg-fin-surface-alt enabled:hover:border-fin-border";

/**
 * An explicit `color` recolours the whole icon treatment; without one the
 * control stays neutral so a toolbar of icons does not turn all-amber.
 */
function variantClass(variant: UIActionIconProps["variant"], accent: Accent, tinted: boolean): string {
  switch (variant) {
    case "filled":
      return cn(
        "border border-transparent",
        accent.solid,
        accent.onSolid,
        "enabled:hover:brightness-110 enabled:active:brightness-95",
      );
    case "light":
      return cn("border border-transparent", accent.tint, accent.text, accent.tintHover);
    case "outline":
      return cn(
        "border bg-transparent",
        tinted ? accent.border : "border-fin-border",
        tinted ? accent.text : "text-fin-text-muted",
        SQUARE_HOVER,
        "enabled:hover:text-fin-text",
      );
    case "default":
      return "border border-fin-border bg-fin-surface-alt text-fin-text enabled:hover:bg-fin-surface";
    case "subtle":
    case "transparent":
    default:
      return cn(
        "border border-transparent bg-transparent",
        tinted ? accent.text : "text-fin-text-muted",
        SQUARE_HOVER,
        "enabled:hover:text-fin-text",
      );
  }
}

const Spinner = () => (
  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
);

export function ActionIcon(props: UIActionIconProps) {
  const [known, _rest] = splitProps(props, [
    "children",
    "className",
    "style",
    "onClick",
    "data-testid",
    "id",
    "variant",
    "color",
    "size",
    "radius",
    "disabled",
    "loading",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  const accent = createMemo(() => ACCENTS[tokenFor(known.color)]);
  const tinted = createMemo(() => known.color != null);
  const disabledOrLoading = () => known.disabled || known.loading;
  const ariaBusy = () => (known.loading ? true : undefined);

  return (
    <button
      type="button"
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(
        "inline-flex shrink-0 items-center justify-center p-0 transition-[background-color,border-color,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-[0.45]",
        known.radius == null ? "rounded-[6px]" : undefined,
        variantClass(known.variant, accent(), tinted()),
        squareClasses(known.size),
        radiusClass(known.radius),
        known.className,
      )}
      style={{ ...sizeStyle(known.size), ...known.style }}
      disabled={disabledOrLoading()}
      aria-busy={ariaBusy()}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
      {...(_rest as Record<string, unknown>)}
    >
      <Show when={known.loading} fallback={known.children}><Spinner /></Show>
    </button>
  );
}
