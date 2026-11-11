import { useCallback, useState, type CSSProperties } from "react";
import { cn } from "../cn";
import type { UIChipProps, UIColor } from "../types";

function chipSizeClasses(size?: UIChipProps["size"]): string {
  return size === "xs" || size === "sm" ? "text-xs px-2 py-1" : "text-sm px-3 py-1.5";
}

function toneClasses(color?: UIColor): { checked: string; border: string } {
  switch (color) {
    case "success":
      return { checked: "bg-fin-positive text-fin-bg", border: "border-fin-positive text-fin-positive" };
    case "error":
    case "danger":
      return { checked: "bg-fin-negative text-fin-bg", border: "border-fin-negative text-fin-negative" };
    case "warning":
      return { checked: "bg-fin-warning text-fin-bg", border: "border-fin-warning text-fin-warning" };
    case "info":
    case "primary":
      return { checked: "bg-fin-primary text-fin-bg", border: "border-fin-primary text-fin-primary" };
    case "secondary":
      return { checked: "bg-fin-text-muted text-fin-bg", border: "border-fin-text-muted text-fin-text-muted" };
    default:
      return { checked: "bg-fin-surface-alt text-fin-text", border: "border-fin-border text-fin-text-muted" };
  }
}

export function Chip({
  checked,
  defaultChecked,
  onChange,
  disabled,
  size,
  color,
  variant,
  label,
  value: _value,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  onClick,
}: UIChipProps) {
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState<boolean>(defaultChecked ?? false);
  const isChecked = isControlled ? checked : internalChecked;
  const { checked: toneChecked, border: toneBorder } = toneClasses(color);
  const isOutline = variant === "outline";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      onClick?.(e as never);
      const next = !isChecked;
      if (!isControlled) setInternalChecked(next);
      onChange?.(next);
    },
    [disabled, isChecked, isControlled, onChange, onClick],
  );

  const base = cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-transparent transition-colors",
    chipSizeClasses(size),
    disabled ? "opacity-50 cursor-default" : "cursor-pointer",
    className,
  );

  const variantClass = isOutline
    ? isChecked
      ? toneBorder
      : cn("border-fin-border bg-transparent text-fin-text-muted hover:bg-fin-surface-alt")
    : isChecked
      ? toneChecked
      : cn("border-fin-border bg-transparent text-fin-text-muted hover:bg-fin-surface-alt");

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked}
      disabled={disabled}
      id={id}
      data-testid={testId}
      className={cn(base, variantClass)}
      style={style as CSSProperties}
      onClick={handleClick}
    >
      {children ?? label}
    </button>
  );
}
