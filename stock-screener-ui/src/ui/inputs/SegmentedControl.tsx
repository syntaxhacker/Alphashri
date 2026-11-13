import { createMemo, createSignal, For, splitProps } from "solid-js";
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

export function SegmentedControl(props: UISegmentedControlProps) {
  const [known, rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "data",
    "color",
    "size",
    "fullWidth",
    "withItemsBorders",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const isControlled = createMemo(() => known.value !== undefined);
  const [internal, setInternal] = createSignal<string | undefined>(known.defaultValue);
  const current = createMemo(() => (isControlled() ? known.value : internal()));
  const items = createMemo(() => normalize(known.data));

  const handleChange = (v: string) => {
    if (!isControlled()) setInternal(v);
    known.onChange?.(v);
  };

  const rootClass = createMemo(() =>
    cn(
      "inline-flex overflow-hidden rounded-fin border border-fin-border bg-fin-surface text-sm",
      known.fullWidth ? "w-full" : "",
      known.className,
    ),
  );

  return (
    <div role="group" id={known.id} data-testid={known["data-testid"]} className={rootClass()} style={known.style} {...rest}>
      <For each={items()}>{(item, i) => (
        <button
          type="button"
          aria-pressed={current() === item.value}
          data-value={item.value}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            handleChange(item.value);
          }}
          className={cn(
            "flex-1 cursor-pointer select-none transition-colors whitespace-nowrap",
            itemSizeClasses(known.size),
            "border-b border-t border-fin-border",
            i() === 0 ? "border-l rounded-l-fin" : "border-x border-fin-border",
            i() === items().length - 1 ? "border-r rounded-r-fin" : "",
            current() === item.value ? "bg-fin-primary text-white border-fin-primary" : "text-fin-text hover:bg-fin-surface-alt",
            item.disabled && "opacity-50 cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary",
          )}
        >
          {item.label}
        </button>
      )}</For>
    </div>
  );
}
