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

export function Button({
  children,
  leftSection,
  rightSection,
  className,
  style,
  onClick,
  "data-testid": testId,
  variant = "filled",
  color,
  size = "md",
  radius,
  fullWidth,
  disabled,
  loading,
  type,
  id,
  onMouseEnter,
  onMouseLeave,
  _compact,
  elevation: _elevation,
  spacing: _spacing,
  alignItems: _alignItems,
  ...rest
}: UIButtonProps) {
  const token = colorToken(color);
  const disabledOrLoading = disabled || loading;
  void _elevation; void _spacing; void _alignItems;

  // `compact` is accepted for backward compat but has no dedicated Tailwind
  // mapping; sizing is driven by `size`. Deliberately not forwarded to the DOM.

  return (
    <button
      type={type ?? "button"}
      id={id}
      data-testid={testId}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass(variant, token),
        SIZE_CLASSES[size],
        radiusClass(radius),
        fullWidth && "w-full",
        className,
      )}
      style={{ ...(typeof radius === "number" ? { borderRadius: radius } : {}), ...style }}
      disabled={disabledOrLoading}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...rest}
    >
      {leftSection || loading ? (
        <span className="flex-shrink-0 mr-2">{leftSection ?? <Spinner />}</span>
      ) : null}
      {children}
      {rightSection ? <span className="flex-shrink-0 ml-2">{rightSection}</span> : null}
    </button>
  );
}
