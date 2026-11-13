import { createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIButtonProps, UISize } from "../types";

const SIZE_CLASSES: Record<UISize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-3.5 py-2 text-sm",
  lg: "px-4 py-2.5 text-base",
  xl: "px-5 py-3 text-base",
};

function colorToken(color?: UIButtonProps["color"]): string {
  const map: Record<string, string> = {
    success: "positive",
    error: "negative",
    danger: "negative",
    warning: "warning",
    info: "info",
    secondary: "text-muted",
  };
  return color ? (map[String(color)] ?? "primary") : "primary";
}

function radiusClass(radius?: UIButtonProps["radius"]): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return undefined; // applied via inline style
  switch (radius) {
    case "xs":
      return "rounded-sm";
    case "sm":
      return "rounded";
    case "md":
      return "rounded-fin";
    case "lg":
      return "rounded-lg";
    case "xl":
      return "rounded-xl";
    default:
      return "rounded-fin";
  }
}

function variantClass(variant: UIButtonProps["variant"], token: string): string {
  switch (variant) {
    case "filled":
      return `bg-fin-${token} text-fin-bg hover:opacity-90`;
    case "outline":
    case "default":
      return `border border-fin-${token} text-fin-${token} bg-transparent hover:bg-fin-surface-alt`;
    case "light":
      return `bg-fin-${token}/10 text-fin-${token} border border-fin-${token}/20 hover:bg-fin-${token}/20`;
    case "subtle":
      return `bg-fin-surface-alt text-fin-text hover:bg-fin-surface`;
    case "transparent":
      return `text-fin-${token} bg-transparent hover:text-fin-text hover:bg-fin-surface-alt`;
    case "white":
      return `bg-fin-surface text-fin-text border border-fin-border hover:bg-fin-surface-alt`;
    default:
      return `bg-fin-${token} text-fin-bg hover:opacity-90`;
  }
}

const Spinner = () => (
  <span className="inline-block w-3 h-3 border-2 border-fin-text border-t-transparent rounded-full animate-spin" aria-hidden="true" />
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
    "_compact",
    "_elevation",
    "_spacing",
    "_alignItems",
  ]);

  const token = createMemo(() => colorToken(known.color));
  const disabledOrLoading = () => known.disabled || known.loading;
  void known._elevation; void known._spacing; void known._alignItems;

  // `compact` is accepted for backward compat but has no dedicated Tailwind
  // mapping; sizing is driven by `size`. Deliberately not forwarded to the DOM.
  void known._compact;

  return (
    <button
      type={known.type ?? "button"}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass(known.variant, token()),
        SIZE_CLASSES[known.size],
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
        <span className="flex-shrink-0 mr-2">{known.leftSection ?? <Spinner />}</span>
      ) : null}
      {known.children}
      {known.rightSection ? <span className="flex-shrink-0 ml-2">{known.rightSection}</span> : null}
    </button>
  );
}
