import { useCallback, useState, type CSSProperties } from "react";
import { cn } from "../cn";
import type { UISegmentedControlProps } from "../types";

type NormalizedItem = { value: string; label: string; disabled?: boolean };

function normalize(data: UISegmentedControlProps["data"]): NormalizedItem[] {
  return (data ?? []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
}

function itemSizeClasses(size?: UISegmentedControlProps["size"]): string {
  switch (size) {
    case "xs":
    case "sm":
      return "text-xs px-2 py-1.5";
    case "lg":
    case "xl":
      return "text-base px-4 py-2";
    case "md":
    default:
      return "text-sm px-3 py-2";
  }
}

export function SegmentedControl({
  value,
  defaultValue,
  onChange,
  data,
  color: _color,
  size,
  fullWidth,
  withItemsBorders: _withItemsBorders,
  className,
  style,
  id,
  "data-testid": testId,
}: UISegmentedControlProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const current = isControlled ? value : internal;
  const items = normalize(data);

  const handleChange = useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v);
      onChange?.(v);
    },
    [isControlled, onChange],
  );

  const rootClass = cn(
    "inline-flex overflow-hidden rounded-fin border border-fin-border bg-fin-surface text-sm",
    fullWidth ? "w-full" : "",
    className,
  );

  return (
    <div role="group" id={id} data-testid={testId} className={rootClass} style={style as CSSProperties}>
      {items.map((item, i) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={current === item.value}
          data-value={item.value}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            handleChange(item.value);
          }}
          className={cn(
            "flex-1 cursor-pointer select-none transition-colors",
            itemSizeClasses(size),
            "border-b border-t border-fin-border",
            i === 0 ? "border-l rounded-l-fin" : "border-x border-fin-border",
            i === items.length - 1 ? "border-r rounded-r-fin" : "",
            current === item.value ? "bg-fin-primary text-white border-fin-primary" : "text-fin-text hover:bg-fin-surface-alt",
            item.disabled && "opacity-50 cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
