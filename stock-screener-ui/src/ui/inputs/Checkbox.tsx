import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "../cn";
import type { UICheckboxProps } from "../types";

function boxSizeClasses(size?: UICheckboxProps["size"]): string {
  return size === "xs" || size === "sm" ? "h-4 w-4" : "h-5 w-5";
}

function toneClass(color?: UICheckboxProps["color"]): string {
  switch (color) {
    case "error":
    case "danger":
      return "border-fin-negative peer-checked:bg-fin-negative";
    case "warning":
      return "border-fin-warning peer-checked:bg-fin-warning";
    case "info":
    case "primary":
      return "border-fin-primary peer-checked:bg-fin-primary";
    case "secondary":
      return "border-fin-text-muted peer-checked:bg-fin-text-muted";
    default:
      return "border-fin-border peer-checked:bg-fin-positive";
  }
}

export function Checkbox({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  size,
  color,
  indeterminate,
  description,
  className,
  style,
  id,
  "data-testid": testId,
  children: _children,
  onClick: _onClick,
  onMouseEnter: _onMouseEnter,
  onMouseLeave: _onMouseLeave,
}: UICheckboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `indeterminate` is a property, not an HTML attribute: sync it imperatively.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  const rootClass = cn("inline-flex items-center gap-2 text-sm leading-none", disabled && "opacity-50", className);
  const boxClass = cn(
    "flex items-center justify-center shrink-0 rounded-fin border border-fin-border bg-fin-surface text-fin-bg transition-colors",
    boxSizeClasses(size),
    toneClass(color),
    indeterminate && "border-fin-primary",
    disabled && "opacity-50 cursor-not-allowed",
  );

  const control = (
    <span className="relative inline-block shrink-0">
      <input
        ref={inputRef}
        type="checkbox"
        role="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        id={id}
        data-testid={testId}
        className="peer absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent border-none z-10"
      />
      <span className={boxClass}>
        {indeterminate ? "—" : checked ? "✔" : ""}
      </span>
    </span>
  );

  if (!label && !description) {
    return (
      <span className={cn("inline-flex items-center", className)} data-testid={testId ? `${testId}-wrapper` : undefined} style={style as CSSProperties}>
        {control}
      </span>
    );
  }

  return (
    <label className={rootClass} style={style as CSSProperties} data-testid={testId ? `${testId}-group` : undefined}>
      {control}
      <span className="leading-none">
        {label ? <span className="text-fin-text">{label}</span> : null}
        {description ? <span className="text-xs text-fin-text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
