import { cn } from "../cn";
import type { UIActionIconProps } from "../types";

const SIZE_CLASSES: Record<string, string> = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-sm",
  md: "w-9 h-9 text-sm",
  lg: "w-10 h-10 text-base",
  xl: "w-12 h-12 text-base",
};

function colorToken(color?: UIActionIconProps["color"]): string {
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

function radiusClass(radius?: UIActionIconProps["radius"]): string | undefined {
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

function sizeStyle(size?: UIActionIconProps["size"]): { width?: string; height?: string } | undefined {
  if (size == null || typeof size !== "number") return undefined;
  return { width: `${size}px`, height: `${size}px` };
}

function variantClass(variant: UIActionIconProps["variant"], token: string): string {
  switch (variant) {
    case "filled":
      return `bg-fin-${token} text-fin-bg hover:opacity-90`;
    case "light":
      return `bg-fin-surface-alt text-fin-text hover:bg-fin-surface`;
    case "outline":
    case "default":
    case "subtle":
    case "transparent":
    default:
      return `text-fin-${token} bg-transparent hover:bg-fin-surface-alt hover:text-fin-text`;
  }
}

const Spinner = () => (
  <span className="inline-block w-3 h-3 border-2 border-fin-text border-t-transparent rounded-full animate-spin" aria-hidden="true" />
);

export function ActionIcon({
  children,
  className,
  style,
  onClick,
  "data-testid": testId,
  variant,
  color,
  size,
  radius,
  disabled,
  loading,
  id,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UIActionIconProps) {
  const token = colorToken(color);
  const disabledOrLoading = disabled || loading;

  return (
    <button
      type="button"
      id={id}
      data-testid={testId}
      className={cn(
        "inline-flex items-center justify-center rounded-fin transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass(variant, token),
        typeof size === "string" ? SIZE_CLASSES[size] : undefined,
        radiusClass(radius),
        className,
      )}
      style={{ ...sizeStyle(size), ...(style as React.CSSProperties) }}
      disabled={disabledOrLoading}
      aria-busy={loading || undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}
