import { useMemo } from "react";
import { Box, Flex, Text } from "@/ui";

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

/**
 * Compact HTML legend mirroring what's drawn on the TradingView pattern chart:
 * one swatch + label per pattern name (boundary segments share a name, so they
 * collapse to a single entry) plus `TLS`/`TLR` when standalone support or
 * resistance segments are present. Entries are clickable to show/hide that
 * series on the chart (lightweight-charts has no built-in legend toggle).
 * Renders nothing when there are no lines.
 */
export function PatternChartLegend({ lines, levels, markers, hidden, onToggle }: PatternChartLegendProps) {
  const entries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const line of [...(lines ?? []), ...(levels ?? []), ...(markers ?? [])]) {
      if (!line?.name || !line?.color) continue;
      if (!seen.has(line.name)) seen.set(line.name, line.color);
    }
    return [...seen.entries()].map(([name, color]) => ({ name, color }));
  }, [lines, levels, markers]);

  if (entries.length === 0) return null;

  return (
    <Flex gap="xs" justify="center" align="center" wrap="wrap" data-testid="patterns-chart-legend">
      {entries.map((entry) => {
        const isHidden = hidden?.has(entry.name) ?? false;
        const interactive = Boolean(onToggle);
        return (
          <Box
            key={entry.name}
            component={interactive ? "button" : "span"}
            type={interactive ? "button" : undefined}
            onClick={interactive ? () => onToggle?.(entry.name) : undefined}
            aria-pressed={interactive ? !isHidden : undefined}
            title={interactive ? (isHidden ? `Show ${entry.name}` : `Hide ${entry.name}`) : undefined}
            data-testid={`patterns-chart-legend-item-${entry.name}`}
            className={`m-0 inline-flex items-center gap-1 rounded-fin border-0 bg-transparent p-[2px] font-[inherit] transition-opacity duration-[120ms] ${
              interactive ? "cursor-pointer hover:bg-fin-surface-alt focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary" : "cursor-default"
            }`}
            style={{ opacity: isHidden ? 0.4 : 1 }}
          >
            <Box
              w={8}
              h={8}
              className="rounded-full"
              style={{ "background-color": entry.color, filter: isHidden ? "grayscale(1)" : undefined }}
            />
            <Text
              size="xs"
              c="dimmed"
              style={isHidden ? { "text-decoration": "line-through" } : undefined}
            >
              {entry.name}
            </Text>
          </Box>
        );
      })}
    </Flex>
  );
}
