import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISwitchProps } from "../types";

function toneClass(color?: UISwitchProps["color"]): string {
  switch (color) {
    case "error":
    case "danger":
      return "peer-checked:bg-fin-negative";
    case "warning":
      return "peer-checked:bg-fin-warning";
    case "info":
    case "primary":
      return "peer-checked:bg-fin-primary";
    case "secondary":
      return "peer-checked:bg-fin-text-muted";
    default:
      return "peer-checked:bg-fin-positive";
  }
}

export function Switch(props: UISwitchProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
    "size",
    "color",
    "onLabel",
    "offLabel",
    "description",
    "className",
    "style",
    "id",
    "data-testid",
    "children",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  const rootClass = cn("inline-flex items-center gap-3 text-sm leading-none", known.disabled && "opacity-50", known.className);

  const control = (
    <span className="relative inline-block shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={known.checked}
        defaultChecked={known.defaultChecked}
        onChange={(e) => known.onChange?.(e)}
        disabled={known.disabled}
        id={known.id}
        data-testid={known["data-testid"]}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex items-center h-full rounded-full border border-fin-border bg-fin-surface transition-colors duration-200",
          trackSizeClasses(known.size),
          "peer-checked:" + toneClass(known.color),
          "peer-focus-visible:ring-1 peer-focus-visible:ring-fin-primary",
          known.disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "my-auto block rounded-full bg-fin-bg shadow-sm transition-transform duration-200",
            thumbSizeClasses(known.size),
            "mx-1 peer-checked:ml-auto peer-checked:mr-1",
          )}
          aria-hidden="true"
        />
      </span>
    </span>
  );

  if (!known.label && !known.description) {
    return (
      <span className={cn("inline-flex items-center", known.className)} data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined} style={known.style}>
        {control}
      </span>
    );
  }

  return (
    <label className={rootClass} style={known.style} data-testid={known["data-testid"] ? `${known["data-testid"]}-group` : undefined}>
      {control}
      <div className="leading-none">
        {known.label ? <span className="text-fin-text">{known.label}</span> : null}
        {known.description ? <span className="text-xs text-fin-text-muted">{known.description}</span> : null}
      </div>
    </label>
  );
}

function trackSizeClasses(size?: UISwitchProps["size"]): string {
  return size === "xs" || size === "sm" ? "w-9 h-5" : "w-11 h-6";
}

function thumbSizeClasses(size?: UISwitchProps["size"]): string {
  return size === "xs" || size === "sm" ? "h-3 w-3" : "h-4 w-4";
}
