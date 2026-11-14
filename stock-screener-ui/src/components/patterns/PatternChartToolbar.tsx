import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Box, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { ChartTimeframeSelect } from "./ChartTimeframeSelect";

export interface PatternChartToolbarProps {
  /** Chart title (symbol, or `SYMBOL · Pattern name` in the fullscreen view). */
  title: JSX.Element;
  /** Optional test id for the title text (page header keeps `chart-title`). */
  titleTestId?: string;
  /** Title typography size (default `sm`; the page header uses `md`). */
  titleSize?: "sm" | "md";
  /** Optional node rendered before the title (e.g. the page's back button). */
  leading?: JSX.Element;
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
export function PatternChartToolbar(props: PatternChartToolbarProps) {
  const titleSize = () => props.titleSize ?? "sm";

  return (
    <ToolbarRow
      gap={8}
      wrap
      data-testid="patterns-chart-toolbar"
      className="min-w-0"
    >
      {props.leading}
      <Text size={titleSize()} fw={titleSize() === "md" ? 700 : 600} truncate data-testid={props.titleTestId}>
        {props.title}
      </Text>
      <Show when={props.onTimeframeChange && props.timeframe != null}>
        <Box data-testid="patterns-fullscreen-timeframe">
          <ChartTimeframeSelect
            timeframes={props.timeframes ?? []}
            value={props.timeframe!}
            onChange={props.onTimeframeChange!}
          />
        </Box>
      </Show>
      <Show when={props.onAsOfChange}>
        <ToolbarRow gap={8} data-testid="patterns-fullscreen-asof-controls">
          <Box className="flex flex-col gap-1">
            <Text size="xs" c="dimmed">
              From
            </Text>
            <TextInput
              type="datetime-local"
              value={props.fromDate ?? ""}
              onChange={(v) => props.onAsOfChange?.(props.asOf ?? null, v ? String(v) : null)}
              size="sm"
              w={190}
              data-testid="patterns-fullscreen-asof-from"
            />
          </Box>
          <Box className="flex flex-col gap-1">
            <Text size="xs" c="dimmed">
              As of
            </Text>
            <TextInput
              type="datetime-local"
              value={props.asOf ?? ""}
              onChange={(v) => props.onAsOfChange?.(v ? String(v) : null, props.fromDate ?? null)}
              size="sm"
              w={190}
              data-testid="patterns-fullscreen-asof-to"
            />
          </Box>
        </ToolbarRow>
      </Show>
      <Show when={props.loading}>
        <Loader size="xs" data-testid="patterns-fullscreen-loading" />
      </Show>
    </ToolbarRow>
  );
}
