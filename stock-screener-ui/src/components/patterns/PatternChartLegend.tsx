import { createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Flex, Text } from "@/ui";

type CSSProperties = JSX.CSSProperties;

export interface PatternLegendLine {
  name: string;
  color: string;
}

export interface PatternChartLegendProps {
  lines: PatternLegendLine[];
  levels?: PatternLegendLine[];
  markers?: PatternLegendLine[];
  hidden?: ReadonlySet<string>;
  onToggle?: (name: string) => void;
  /**
   * Maximum visible entries before the `+N` overflow chip. Container-driven:
   * `legendEntryBudget()` maps widths to 3 / 5 / 7.
   */
  maxEntries?: number;
}

/** Container-driven legend density (not a viewport breakpoint). */
export function legendEntryBudget(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 7;
  if (width < 420) return 3;
  if (width < 640) return 5;
  return 7;
}

interface LegendEntry {
  name: string;
  color: string;
}

const ENTRY_CLASS =
  "m-0 inline-flex shrink-0 items-center gap-1 rounded-fin border-0 bg-transparent p-[2px] font-[inherit] transition-opacity duration-[120ms]";

function EntryButton(props: {
  entry: LegendEntry;
  isHidden: boolean;
  interactive: boolean;
  onToggle?: (name: string) => void;
}) {
  const title = () =>
    props.interactive
      ? props.isHidden
        ? `Show ${props.entry.name}`
        : `Hide ${props.entry.name}`
      : undefined;
  const style: CSSProperties = { opacity: props.isHidden ? "0.4" : "1" };
  const swatch = (
    <Box
      w={8}
      h={8}
      className="rounded-full"
      style={{
        "background-color": props.entry.color,
        filter: props.isHidden ? "grayscale(1)" : undefined,
      }}
    />
  );
  const label = (
    <Text
      size="xs"
      c="dimmed"
      style={props.isHidden ? { "text-decoration": "line-through" } : undefined}
    >
      {props.entry.name}
    </Text>
  );

  return (
    <Show
      when={props.interactive}
      fallback={
        <span
          data-testid={`patterns-chart-legend-item-${props.entry.name}`}
          class={`${ENTRY_CLASS} cursor-default`}
          style={style}
        >
          {swatch}
          {label}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => props.onToggle?.(props.entry.name)}
        aria-pressed={!props.isHidden}
        title={title()}
        data-testid={`patterns-chart-legend-item-${props.entry.name}`}
        class={`${ENTRY_CLASS} cursor-pointer hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text`}
        style={style}
      >
        {swatch}
        {label}
      </button>
    </Show>
  );
}

/**
 * Compact HTML legend mirroring what's drawn on the TradingView pattern chart:
 * one swatch + label per pattern name (boundary segments share a name, so they
 * collapse to a single entry) plus `TLS`/`TLR` when standalone support or
 * resistance segments are present. Entries are clickable to show/hide that
 * series on the chart (lightweight-charts has no built-in legend toggle).
 * Renders nothing when there are no lines.
 */
export function PatternChartLegend(props: PatternChartLegendProps) {
  const entries = createMemo(() => {
    const seen = new Map<string, string>();
    for (const line of [
      ...(props.lines ?? []),
      ...(props.levels ?? []),
      ...(props.markers ?? []),
    ]) {
      if (!line?.name || !line?.color) continue;
      if (!seen.has(line.name)) seen.set(line.name, line.color);
    }
    return [...seen.entries()].map(([name, color]) => ({ name, color }));
  });

  const budget = createMemo(() => {
    const raw = props.maxEntries;
    if (raw == null || !Number.isFinite(raw)) return Number.POSITIVE_INFINITY;
    return Math.max(1, Math.floor(raw));
  });
  const visible = createMemo(() => entries().slice(0, budget()));
  const overflow = createMemo(() => Math.max(0, entries().length - visible().length));
  const overflowNames = createMemo(() =>
    entries()
      .slice(visible().length)
      .map((entry) => entry.name)
      .join(", "),
  );

  return (
    <Show when={entries().length > 0}>
      <Flex
        gap="xs"
        justify="flex-start"
        align="center"
        wrap="nowrap"
        data-testid="patterns-chart-legend"
        className="min-w-0 overflow-hidden"
      >
        <For each={visible()}>
          {(entry) => (
            <EntryButton
              entry={entry}
              isHidden={props.hidden?.has(entry.name) ?? false}
              interactive={Boolean(props.onToggle)}
              onToggle={props.onToggle}
            />
          )}
        </For>
        <Show when={overflow() > 0}>
          <span
            class="m-0 inline-flex shrink-0 items-center rounded-fin px-[2px] font-mono text-ui-micro leading-none text-fin-text-muted"
            data-testid="patterns-chart-legend-overflow"
            title={overflowNames()}
            aria-label={`${overflow()} more legend entries: ${overflowNames()}`}
          >
            +{overflow()}
          </span>
        </Show>
      </Flex>
    </Show>
  );
}
