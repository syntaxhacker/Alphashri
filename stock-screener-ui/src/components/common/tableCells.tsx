import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Badge, Text, type UIVariant } from "@/ui";
import { cn } from "@/ui/cn";
import { getPnLTextColor } from "@/utils/ui-helpers";

/**
 * The one place table cells get their type treatment.
 *
 * Before this existed, ~30 column-definition files each hand-rolled
 * `<Text size="xs" className="tabular-nums">`, so the same numeric column could
 * appear mono on one page, proportional on another, and 11px vs 12px between
 * two adjacent tables. Numbers must be mono + tabular everywhere or columns do
 * not line up across surfaces.
 */

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
  return (
    <div class="flex min-w-0 flex-col leading-tight">
      <Text
        size="xs"
        fw={props.fw ?? 700}
        span
        truncate
        data-testid={props.testId}
        className={cn("text-left min-w-0", props.onOpen && "cursor-pointer")}
        onClick={props.onOpen ? () => props.onOpen?.(props.symbol) : undefined}
      >
        {props.symbol}
      </Text>
      <Show when={props.name}>
        <Text size="xs" c="dimmed" span truncate className="text-left min-w-0 text-[10px]">
          {props.name}
        </Text>
      </Show>
    </div>
  );
}

/** Badge column (type, status, flag): centred, xs only. */
export function BadgeCell(props: {
  label: string;
  color?: string;
  variant?: UIVariant;
  testId?: string;
  title?: string;
}): JSX.Element {
  return (
    <div class="flex items-center justify-center">
      <Badge
        size="xs"
        color={props.color}
        variant={props.variant ?? "light"}
        data-testid={props.testId}
        title={props.title}
      >
        {props.label}
      </Badge>
    </div>
  );
}
