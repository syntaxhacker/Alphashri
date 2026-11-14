import { createMemo, createSignal, For, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UISegmentedControlProps } from "../types";

/**
 * SegmentedControl = a view switch, not a filter row. One shared bordered
 * track (6px radius, 1px hairline) with 4px-radius items inside, and the
 * active item is a filled inset block — like a physical toggle. Item height
 * (24px) sits deliberately between a Chip (20px) and the track itself.
 */
type NormalizedItem = { value: string; label: string; disabled?: boolean };

type SegBox = { item: number; font: number; px: number };

const SEG_BOX: Record<string, SegBox> = {
  xs: { item: 20, font: 9, px: 6 },
  sm: { item: 22, font: 10, px: 7 },
  md: { item: 24, font: 11, px: 8 },
  lg: { item: 28, font: 12, px: 10 },
  xl: { item: 32, font: 13, px: 12 },
};

const TRACK_PAD = 2;
const TRACK_RADIUS = 6;
const ITEM_RADIUS = 4;

function segBox(size?: UISegmentedControlProps["size"]): SegBox {
  return SEG_BOX[String(size)] ?? SEG_BOX.md;
}

function normalize(data: UISegmentedControlProps["data"]): NormalizedItem[] {
  return (data ?? []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
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
  const box = createMemo(() => segBox(known.size));

  const handleChange = (v: string) => {
    if (!isControlled()) setInternal(v);
    known.onChange?.(v);
  };

  const trackStyle = createMemo<Record<string, string>>(() => ({
    height: `${box().item + TRACK_PAD * 2 + 2}px`,
    "border-radius": `${TRACK_RADIUS}px`,
    border: `1px solid ${palette.BORDER}`,
    "background-color": palette.SURFACE,
    padding: `${TRACK_PAD}px`,
  }));

  const itemStyle = createMemo<Record<string, string>>(() => ({
    height: `${box().item}px`,
    "border-radius": `${ITEM_RADIUS}px`,
    "font-size": `${box().font}px`,
    "line-height": "1",
    "font-weight": "600",
    "padding-left": `${box().px}px`,
    "padding-right": `${box().px}px`,
  }));

  const rootClass = createMemo(() =>
    cn("inline-flex items-stretch gap-0 overflow-hidden", known.fullWidth ? "w-full" : "", known.className),
  );

  return (
    <div role="group" id={known.id} data-testid={known["data-testid"]} className={rootClass()} style={{ ...trackStyle(), ...known.style }} {...rest}>
      <For each={items()}>{(item) => (
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
            "flex-1 inline-flex items-center justify-center cursor-pointer select-none whitespace-nowrap transition-colors",
            current() === item.value
              ? "bg-fin-surface-alt text-fin-text"
              : "bg-transparent text-fin-text-muted hover:text-fin-text",
            item.disabled && "opacity-50 cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary",
          )}
          style={itemStyle()}
        >
          {item.label}
        </button>
      )}</For>
    </div>
  );
}
