import type { ReactNode } from "react";
import { Box, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { ChartTimeframeSelect } from "./ChartTimeframeSelect";

export interface PatternChartToolbarProps {
  /** Chart title (symbol, or `SYMBOL · Pattern name` in the fullscreen view). */
  title: ReactNode;
  /** Optional test id for the title text (page header keeps `chart-title`). */
  titleTestId?: string;
  /** Title typography size (default `sm`; the page header uses `md`). */
  titleSize?: "sm" | "md";
  /** Optional node rendered before the title (e.g. the page's back button). */
  leading?: ReactNode;
  /** Active timeframe; the selector only renders when set with onChange. */
  timeframe?: string | null;
  /** Timeframe ladder for the selector. */
  timeframes?: TFSpec[];
  onTimeframeChange?: (timeframe: string) => void;
  /** Small spinner shown next to the controls while a reload is in flight. */
  loading?: boolean;
  /** As-of replay cutoff (ISO local datetime, null = live). */
  asOf?: string | null;
  /** Replay window start (ISO local datetime, null = any). */
  fromDate?: string | null;
  /** When provided, the From/as-of replay inputs render. */
  onAsOfChange?: (asOf: string | null, fromDate: string | null) => void;
}

/**
 * Control row shared by the fullscreen modal and the `/chart/:symbol` page:
 * title, timeframe selector, as-of replay inputs and a loading spinner.
 *
 * Extracted verbatim from `PatternFullscreenView` so both surfaces stay
 * byte-identical; the `patterns-fullscreen-*` test ids are part of the frozen
 * frontend contract (see `chart_patterns/CONTRACT.md` §6) and are kept.
 */
export function PatternChartToolbar({
  title,
  titleTestId,
  titleSize = "sm",
  leading,
  timeframe,
  timeframes,
  onTimeframeChange,
  loading = false,
  asOf = null,
  fromDate = null,
  onAsOfChange,
}: PatternChartToolbarProps) {
  const asOfControls = onAsOfChange ? (
    <ToolbarRow gap={8} data-testid="patterns-fullscreen-asof-controls">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Text size="xs" c="dimmed">
          From
        </Text>
        <TextInput
          type="datetime-local"
          value={fromDate ?? ""}
          onChange={(v) => onAsOfChange(asOf ?? null, v ? String(v) : null)}
          size="sm"
          w={190}
          data-testid="patterns-fullscreen-asof-from"
        />
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Text size="xs" c="dimmed">
          As of
        </Text>
        <TextInput
          type="datetime-local"
          value={asOf ?? ""}
          onChange={(v) => onAsOfChange(v ? String(v) : null, fromDate ?? null)}
          size="sm"
          w={190}
          data-testid="patterns-fullscreen-asof-to"
        />
      </Box>
    </ToolbarRow>
  ) : null;

  return (
    <ToolbarRow
      gap={8}
      wrap
      data-testid="patterns-chart-toolbar"
      sx={{ minWidth: 0 }}
    >
      {leading}
      <Text size={titleSize} fw={titleSize === "md" ? 700 : 600} truncate data-testid={titleTestId}>
        {title}
      </Text>
      {onTimeframeChange && timeframe != null ? (
        <Box data-testid="patterns-fullscreen-timeframe">
          <ChartTimeframeSelect
            timeframes={timeframes ?? []}
            value={timeframe}
            onChange={onTimeframeChange}
          />
        </Box>
      ) : null}
      {asOfControls}
      {loading ? <Loader size="xs" data-testid="patterns-fullscreen-loading" /> : null}
    </ToolbarRow>
  );
}
