import type { CSSProperties } from "react";
import { cn } from "../cn";
import type { UISwitchProps } from "../types";

function trackSizeClasses(size?: UISwitchProps["size"]): string {
  return size === "xs" || size === "sm" ? "h-5 w-9" : "h-6 w-11";
}

function thumbSizeClasses(size?: UISwitchProps["size"]): string {
  return size === "xs" || size === "sm" ? "h-4 w-4" : "h-5 w-5";
}

function toneClass(color?: UISwitchProps["color"]): string {
  switch (color) {
    case "error":
    case "danger":
      return "bg-fin-negative";
    case "info":
      return "bg-fin-primary";
    default:
      return "bg-fin-positive";
  }
}

export function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  size,
  color,
  onLabel: _onLabel,
  offLabel: _offLabel,
  description,
  className,
  style,
  id,
  "data-testid": testId,
  children: _children,
  onClick: _onClick,
  onMouseEnter: _onMouseEnter,
  onMouseLeave: _onMouseLeave,
}: UISwitchProps) {
  const rootClass = cn("inline-flex items-center gap-3 text-sm leading-none", disabled && "opacity-50", className);

  const control = (
    <span className="relative inline-block shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        id={id}
        data-testid={testId}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex items-center h-full rounded-full border border-fin-border bg-fin-surface transition-colors duration-200",
          trackSizeClasses(size),
          "peer-checked:" + toneClass(color),
          "peer-focus-visible:ring-1 peer-focus-visible:ring-fin-primary",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "my-auto block rounded-full bg-fin-bg shadow-sm transition-transform duration-200",
            thumbSizeClasses(size),
            "mx-1 peer-checked:ml-auto peer-checked:mr-1",
          )}
          aria-hidden="true"
        />
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
      <div className="leading-none">
        {label ? <span className="text-fin-text">{label}</span> : null}
        {description ? <span className="text-xs text-fin-text-muted">{description}</span> : null}
      </div>
    </label>
  );
}
