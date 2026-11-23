import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { SimpleGrid, Text } from "@/ui";
import { cn } from "@/ui/cn";
import { getPnLTextColor } from "@/utils/ui-helpers";

/** Financial text tones, mirrored from the `@/ui` Text tone vocabulary. */
export type KeyValueTone = "default" | "dimmed" | "success" | "error" | "warning" | "primary" | "info";

export interface KeyValueProps {
  label: JSX.Element;
  value: JSX.Element;
  hint?: JSX.Element;
  tone?: KeyValueTone;
  /** Where label, value and hint align. Numeric rows default to the right. */
  align?: "left" | "right";
  /** Price/P&L figures get a monospaced face. Tabular figures are always on. */
  mono?: boolean;
  dense?: boolean;
  className?: string;
  testId?: string;
}

/** A semantic label/value row — `<dl>` so the pairing survives screen readers. */
export function KeyValue(props: KeyValueProps): JSX.Element {
  const dense = () => props.dense ?? false;
  const align = () => props.align ?? "right";
  const tid = (part: string) => (props.testId ? `${props.testId}-${part}` : undefined);
  const textAlign = () => (align() === "right" ? "right" : "left");

  return (
    <dl
      data-kv=""
      data-testid={props.testId}
      className={cn("flex flex-col min-w-0 m-0", dense() ? "gap-1" : "gap-2", props.className)}
    >
      <dt
        data-testid={tid("label")}
        className="text-fin-text-muted uppercase"
        style={{
          "font-size": dense() ? "10px" : "11px",
          "letter-spacing": "0.06em",
          "line-height": "1.2",
          "text-align": textAlign(),
        }}
      >
        {props.label}
      </dt>
      <dd
        data-testid={tid("group")}
        className="flex flex-col min-w-0 m-0"
        style={{ gap: dense() ? "2px" : "4px", "text-align": textAlign() }}
      >
        <Text
          component="span"
          fw={700}
          c={props.tone ?? "default"}
          data-testid={tid("value")}
          className={cn("leading-none whitespace-nowrap", props.mono && "font-mono")}
          style={{
            "font-size": dense() ? "11px" : "12px",
            "font-variant-numeric": "tabular-nums",
            "text-align": textAlign(),
          }}
        >
          {props.value}
        </Text>
        <Show when={props.hint != null}>
          <Text
            component="span"
            c="dimmed"
            data-testid={tid("hint")}
            style={{ "font-size": "10px", "line-height": "1.2", "text-align": textAlign() }}
          >
            {props.hint}
          </Text>
        </Show>
      </dd>
    </dl>
  );
}

export interface DeltaProps {
  entry: string;
  mark: string;
  pnl: string;
  /** Signed number used to pick the P&L tone; preferred over parsing `pnl`. */
  value?: number;
  tone?: KeyValueTone;
  mono?: boolean;
  className?: string;
  testId?: string;
  /** Full spoken phrase; defaults to `"entry to mark, pnl"`. */
  ariaLabel?: string;
}

/**
 * `entry → mark · pnl` as four separate spans. The separators are aria-hidden
 * and a group label carries the whole phrase, so a screen reader hears one
 * sentence instead of "twelve point five, right arrow, thirteen point six".
 */
export function Delta(props: DeltaProps): JSX.Element {
  const tone = () =>
    props.tone ?? (props.value === 0 ? "default" : getPnLTextColor(props.value ?? 0));
  const phrase = () => props.ariaLabel ?? `${props.entry} to ${props.mark}, ${props.pnl}`;
  const part = (name: string) => (props.testId ? `${props.testId}-${name}` : undefined);

  return (
    <span
      role="group"
      aria-label={phrase()}
      data-delta=""
      data-testid={props.testId}
      className={cn("inline-flex items-baseline gap-1 whitespace-nowrap", props.mono && "font-mono")}
      style={{ "font-variant-numeric": "tabular-nums" }}
    >
      <span data-testid={part("entry")}>{props.entry}</span>
      <span aria-hidden="true" data-testid={part("arrow")}>→</span>
      <span data-testid={part("mark")}>{props.mark}</span>
      <span aria-hidden="true" data-testid={part("sep")}>·</span>
      <Text component="span" fw={700} c={tone()} data-testid={part("pnl")}>
        {props.pnl}
      </Text>
    </span>
  );
}

export interface KeyValuePairProps extends Omit<KeyValueProps, "value"> {
  entry: string;
  mark: string;
  pnl: string;
  /** Signed P&L used for the delta tone. */
  pnlValue?: number;
  deltaTone?: KeyValueTone;
}

/** A `KeyValue` whose value is a `Delta` — the migration target for inline strings. */
export function KeyValuePair(props: KeyValuePairProps): JSX.Element {
  const tid = props.testId;
  return (
    <KeyValue
      label={props.label}
      hint={props.hint}
      tone={props.tone}
      align={props.align}
      mono={props.mono}
      dense={props.dense}
      className={props.className}
      testId={tid}
      value={
        <Delta
          entry={props.entry}
          mark={props.mark}
          pnl={props.pnl}
          value={props.pnlValue}
          tone={props.deltaTone}
          mono={props.mono}
          testId={tid ? `${tid}-delta` : undefined}
        />
      }
    />
  );
}

export interface KeyValueGridProps {
  children?: JSX.Element;
  /** Fixed column count. Omit for auto-fitting responsive columns. */
  cols?: number;
  /** `sm` = 8px, `md` = 16px gaps. */
  gap?: "sm" | "md";
  className?: string;
  testId?: string;
}

export function KeyValueGrid(props: KeyValueGridProps): JSX.Element {
  return (
    <SimpleGrid
      cols={props.cols ?? 2}
      data-testid={props.testId}
      className={cn("w-full", props.className)}
      style={{
        "grid-template-columns": props.cols
          ? `repeat(${props.cols}, minmax(0, 1fr))`
          : "repeat(auto-fit, minmax(140px, 1fr))",
        gap: props.gap === "md" ? "16px" : "8px",
      }}
    >
      {props.children}
    </SimpleGrid>
  );
}
