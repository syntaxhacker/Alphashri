import { createMemo, For, Show } from "solid-js";
import { Box, Flex, Text } from "@/ui";
import type { CSSProperties } from "solid-js";

export interface PatternLegendLine {
  name: string;
  color: string;
}

export interface PatternChartLegendProps {
  /** Line entries as drawn on the chart (see `buildPatternTVData(...).lines`). */
  lines: PatternLegendLine[];
  /** Horizontal level guides (Breakout/Target/Stop) — toggled like lines. */
  levels?: PatternLegendLine[];
  /** Marker overlays (e.g. the single swing-pivot entry) — toggled like lines. */
  markers?: PatternLegendLine[];
  /** Names currently toggled off (hidden) via the legend. */
  hidden?: ReadonlySet<string>;
  /** Toggle a series on/off. When omitted the legend is display-only. */
  onToggle?: (name: string) => void;
}

interface LegendEntry {
  name: string;
  color: string;
}

const ENTRY_CLASS =
  "m-0 inline-flex items-center gap-1 rounded-fin border-0 bg-transparent p-[2px] font-[inherit] transition-opacity duration-[120ms]";

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
      style={{ backgroundColor: props.entry.color, filter: props.isHidden ? "grayscale(1)" : undefined }}
    />
  );
  const label = (
    <Text
      size="xs"
      c="dimmed"
      style={props.isHidden ? { textDecoration: "line-through" } : undefined}
    >
      {props.entry.name}
    </Text>
  );

  return (
    <Show when={props.interactive} fallback={
      <span
        data-testid={`patterns-chart-legend-item-${props.entry.name}`}
        class={`${ENTRY_CLASS} cursor-default`}
        style={style}
      >
        {swatch}
        {label}
      </span>
    }>
      <button
        type="button"
        onClick={() => props.onToggle?.(props.entry.name)}
        aria-pressed={!props.isHidden}
        title={title()}
        data-testid={`patterns-chart-legend-item-${props.entry.name}`}
        class={`${ENTRY_CLASS} cursor-pointer hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary`}
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
    for (const line of [...(props.lines ?? []), ...(props.levels ?? []), ...(props.markers ?? [])]) {
      if (!line?.name || !line?.color) continue;
      if (!seen.has(line.name)) seen.set(line.name, line.color);
    }
    return [...seen.entries()].map(([name, color]) => ({ name, color }));
  });

  return (
    <Show when={entries().length > 0}>
      <Flex gap="xs" justify="center" align="center" wrap="wrap" data-testid="patterns-chart-legend">
        <For each={entries()}>
          {(entry) => (
            <EntryButton
              entry={entry}
              isHidden={props.hidden?.has(entry.name) ?? false}
              interactive={Boolean(props.onToggle)}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </Flex>
    </Show>
  );
}
