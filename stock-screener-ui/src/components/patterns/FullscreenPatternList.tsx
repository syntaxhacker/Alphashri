import { Box, Text, ToolbarRow, UnstyledButton } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { StatusBadge } from "./StatusBadge";
import { formatChartTimestamp } from "./datetime";

/** Identity for a fullscreen pattern hit (mirrors the page's hitIdentity). */
export function fullscreenHitKey(hit: PatternHitDTO): string {
  return `${hit.id ?? `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}`}`;
}

/**
 * Newest-first order: `end_date` DESC (ISO-ish "YYYY-MM-DD HH:MM" sorts
 * lexicographically), tie-break `bars_ago` ASC, then `confidence` DESC.
 */
export function sortHitsNewest<T extends Pick<PatternHitDTO, "end_date" | "bars_ago" | "confidence">>(
  hits: T[],
): T[] {
  return [...hits].sort((a, b) => {
    const endA = a.end_date ?? "";
    const endB = b.end_date ?? "";
    if (endA !== endB) return endB < endA ? -1 : 1;
    if (a.bars_ago !== b.bars_ago) return a.bars_ago - b.bars_ago;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

/** Newest hit in the list (null when empty). */
export function newestHit<T extends Pick<PatternHitDTO, "end_date" | "bars_ago" | "confidence">>(
  hits: T[],
): T | null {
  const sorted = sortHitsNewest(hits);
  return sorted.length > 0 ? sorted[0] : null;
}

export interface FullscreenPatternListProps {
  hits: PatternHitDTO[];
  activeKey: string | null;
  onSelect: (hit: PatternHitDTO) => void;
}

/**
 * Compact single-select list of detected patterns for the fullscreen chart,
 * newest first. Selecting a row replaces the chart's single active pattern
 * (radio-style — no multi-select, no dashed siblings).
 */
export function FullscreenPatternList({ hits, activeKey, onSelect }: FullscreenPatternListProps) {
  const sorted = sortHitsNewest(hits);
  return (
    <Box data-testid="patterns-fullscreen-list" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Text size="xs" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
        {`Patterns (${sorted.length})`}
      </Text>
      {sorted.length === 0 ? (
        <Text size="xs" c="dimmed">
          No patterns detected
        </Text>
      ) : (
        sorted.map((hit, i) => {
          const key = fullscreenHitKey(hit);
          const active = activeKey != null && key === activeKey;
          return (
            <UnstyledButton
              key={key}
              onClick={() => onSelect(hit)}
              data-testid={`patterns-fullscreen-list-item-${i}`}
              data-selected={active ? "true" : undefined}
              aria-pressed={active}
              sx={{
                width: "100%",
                display: "block",
                borderRadius: 1,
                p: 1,
                bgcolor: active ? "action.selected" : "transparent",
                "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
              }}
            >
              <ToolbarRow justify="space-between" gap={4} align="center">
                <Text size="xs" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                  {hit.pattern_name}
                </Text>
                <StatusBadge status={hit.status} />
              </ToolbarRow>
              <ToolbarRow justify="space-between" gap={4} align="center">
                <Text size="xs" c="dimmed" truncate>
                  {`${formatChartTimestamp(hit.end_date)} · ${hit.bars_ago} bar${hit.bars_ago === 1 ? "" : "s"} ago`}
                </Text>
                <Text size="xs" c="dimmed">
                  {`${Math.round(hit.confidence)}%`}
                </Text>
              </ToolbarRow>
            </UnstyledButton>
          );
        })
      )}
    </Box>
  );
}
