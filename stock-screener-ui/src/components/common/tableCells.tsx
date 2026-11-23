import type { JSX } from "solid-js";
import { createEffect, createSignal, Show } from "solid-js";
import { Badge, Box, Text, type UIVariant } from "@/ui";
import { cn } from "@/ui/cn";
import { getPnLTextColor } from "@/utils/ui-helpers";
import { useValueFlash } from "@/utils/valueFlash";

/**
 * Numbers must be mono + tabular everywhere or columns do not line up across surfaces.
 */

/** Dimmed en-dash placeholder for a missing value in a dense table. */
export function DashCell(props: { testId?: string; title?: string }): JSX.Element {
  return (
    <Text size="xs" c="dimmed" data-testid={props.testId} title={props.title}>
      –
    </Text>
  );
}

/** Numeric value: mono, tabular, optional sign colouring. */
export function NumCell(props: {
  value: number | null | undefined;
  /** Render with P&L semantics (green up / red down). */
  signed?: boolean;
  /** Formatter; defaults to the raw number with no grouping. */
  format?: (value: number) => string;
  /** Text when the value is missing or non-finite. */
  dash?: string;
  /** Explicit colour, overriding `signed`. */
  tone?: "default" | "dimmed" | "success" | "error" | "warning" | "primary";
  fw?: number;
  size?: "xs" | "sm";
  align?: "right" | "left";
  title?: string;
  testId?: string;
}): JSX.Element {
  const text = () => {
    const v = props.value;
    if (v == null || !Number.isFinite(v)) return props.dash ?? "—";
    return props.format ? props.format(v) : String(v);
  };
  const colour = () => {
    if (props.tone) return props.tone;
    if (props.signed && props.value != null && Number.isFinite(props.value)) {
      return getPnLTextColor(props.value);
    }
    return undefined;
  };
  return (
    <Text
      size={props.size ?? "xs"}
      fw={props.fw}
      c={colour()}
      span
      title={props.title}
      data-testid={props.testId}
      className={cn(
        "font-mono tabular-nums whitespace-nowrap",
        props.align === "left" ? "text-left" : "text-right",
      )}
      style={{ "font-variant-numeric": "tabular-nums" }}
    >
      {text()}
    </Text>
  );
}

/**
 * Some tables (notably live positions) rebuild their row DOM on every poll tick.
 * Their previous value has to outlive the component, so it is seeded by key.
 */
const lastFlashedValue = new Map<string, number>();

/**
 * Numeric cell that briefly tints its background when a polled value changes.
 * The keyed node restarts the CSS animation even when two consecutive ticks move
 * in the same direction — the class alone would stay applied for the whole 600ms.
 */
export function FlashValue(props: {
  value: number | null | undefined;
  /** Stable identity for a cell whose DOM node is recreated on every tick. */
  flashKey?: string;
  children?: JSX.Element;
  testId?: string;
  className?: string;
  align?: "right" | "left";
  title?: string;
}): JSX.Element {
  const seeded = () => {
    const key = props.flashKey;
    if (key == null) return props.value;
    const previous = lastFlashedValue.get(key);
    if (previous == null || !Number.isFinite(previous)) return props.value;
    return previous;
  };

  const [observed, setObserved] = createSignal<number | null | undefined>(seeded());
  const [epoch, setEpoch] = createSignal(0);
  const flash = useValueFlash(() => {
    epoch();
    return observed();
  });

  createEffect(() => {
    const current = props.value;
    setObserved(current);
    setEpoch((n) => n + 1);
    if (props.flashKey != null && current != null && Number.isFinite(current)) {
      lastFlashedValue.set(props.flashKey, current);
    }
  });

  return (
    <Show when={flash.key() + 1} keyed>
      {(sequence) => (
        <Box
          component="span"
          data-testid={props.testId}
          title={props.title}
          data-flash-key={sequence - 1}
          data-flash-direction={flash.direction()}
          className={cn(
            "font-mono tabular-nums whitespace-nowrap",
            props.align === "left" ? "text-left" : "text-right",
            props.className,
            flash.className(),
          )}
          style={{ "font-variant-numeric": "tabular-nums" }}
        >
          {props.children ??
            (props.value == null || !Number.isFinite(props.value) ? "—" : String(props.value))}
        </Box>
      )}
    </Show>
  );
}

/** Text column (symbol, name, sector): left-aligned, truncating, no mono. */
export function TextCell(props: {
  children?: JSX.Element;
  value?: string | null | undefined;
  dimmed?: boolean;
  fw?: number;
  size?: "xs" | "sm";
  mono?: boolean;
  truncate?: boolean;
  title?: string;
  testId?: string;
}): JSX.Element {
  return (
    <Text
      size={props.size ?? "xs"}
      fw={props.fw}
      c={props.dimmed ? "dimmed" : undefined}
      span
      truncate={props.truncate ?? true}
      title={props.title}
      data-testid={props.testId}
      className={cn("text-left min-w-0", props.mono && "font-mono tabular-nums")}
    >
      {props.children ?? (props.value == null || props.value === "" ? "—" : props.value)}
    </Text>
  );
}

/**
 * Symbol + optional secondary line (company name). The identity column of every
 * table uses this so the primary key is never truncated away.
 */
export function SymbolCell(props: {
  symbol: string;
  name?: string | null;
  fw?: number;
  testId?: string;
  onOpen?: (symbol: string) => void;
}): JSX.Element {
  const open = (event?: MouseEvent) => {
    if (!props.onOpen) return;
    // The symbol is the in-app action: don't also fire a row click handler.
    event?.stopPropagation();
    props.onOpen(props.symbol);
  };
  return (
    <div class="flex min-w-0 flex-col leading-tight">
      <Box
        component="span"
        data-testid={props.testId}
        role={props.onOpen ? "button" : undefined}
        tabIndex={props.onOpen ? 0 : undefined}
        aria-label={props.onOpen ? `Open ${props.symbol} chart` : undefined}
        className={cn(
          "text-xs truncate text-left min-w-0",
          props.onOpen && "cursor-pointer hover:text-fin-primary focus-visible:underline",
        )}
        style={{ "font-weight": props.fw ?? 700 }}
        onClick={props.onOpen ? (event) => open(event) : undefined}
        onKeyDown={
          props.onOpen
            ? (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open();
                }
              }
            : undefined
        }
      >
        {props.symbol}
      </Box>
      <Show when={props.name}>
        <Text size="xs" c="dimmed" span truncate className="text-left min-w-0 text-[10px]">
          {props.name}
        </Text>
      </Show>
    </div>
  );
}

/**
 * Badge column (type, status, flag): centred. The kit's small sizes are 9px —
 * legible in a dense row but cramped next to 12px body text, so the default
 * scales the glyph to match the table's type size. `size` stays overridable.
 */
export function BadgeCell(props: {
  label: string;
  color?: string;
  variant?: UIVariant;
  testId?: string;
  title?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}): JSX.Element {
  return (
    <div class="flex items-center justify-center">
      <Badge
        size={props.size ?? "sm"}
        color={props.color}
        variant={props.variant ?? "light"}
        data-testid={props.testId}
        title={props.title}
        style={{ "font-size": "11px", height: "18px" }}
      >
        {props.label}
      </Badge>
    </div>
  );
}
