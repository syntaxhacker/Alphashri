import { ActionIcon, Box, Button, Modal, Text, Tooltip } from "@/ui";
import {
  IconArrowsMaximize,
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from "@/patterns/icons";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TFSpec,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { PatternChartBody } from "./PatternChartBody";
import { PatternChartToolbar } from "./PatternChartToolbar";

export interface PatternFullscreenViewProps {
  opened: boolean;
  onClose: () => void;
  /**
   * Render as a docked right-rail panel instead of a modal. The panel fills
   * its parent (`height: 100%`) — the caller owns width/position.
   */
  docked?: boolean;
  /** Docked mode only: promote the rail to the fullscreen modal. */
  onMaximize?: () => void;
  /** Docked mode only: step to the previous / next result in the sequence. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Docked mode only: human position label, e.g. `3 / 48`. */
  positionLabel?: string;
  /** Docked mode only: leave replay mode and return to live data. */
  onLive?: () => void;
  /** Symbol when no hit is loaded yet (preview title). */
  symbol?: string | null;
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  /** Detected patterns for the symbol (newest-first single-select list). */
  hits?: PatternHitDTO[];
  /** Switch the chart to the selected single pattern (replaces the active hit). */
  onSelectHit?: (hit: PatternHitDTO) => void;
  /**
   * Kept for API compatibility; the parent passes an empty list so only the
   * active pattern is drawn (no dashed siblings).
   */
  overlays?: PatternOverlay[];
  /**
   * Standalone support/resistance lines from the symbol-chart payload. Falls
   * back to the hit's own `trend_lines` when absent/empty.
   */
  trendLines?: TrendLine[];
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
  /**
   * Active fullscreen timeframe. When set together with `onTimeframeChange`
   * the toolbar renders a Timeframe selector that re-runs detection on that
   * timeframe.
   */
  timeframe?: string | null;
  /** Timeframe ladder for the selector (falls back to the contract ladder). */
  timeframes?: TFSpec[];
  /** Re-fetch the symbol chart + live hits on the newly selected timeframe. */
  onTimeframeChange?: (timeframe: string) => void;
  /** Small loading state shown next to the selector while the TF reloads. */
  loading?: boolean;
  /**
   * As-of replay cutoff (ISO local datetime, null = live). When set together
   * with `onAsOfChange` the toolbar renders From/To replay inputs plus an
   * as-of banner, and the chart is re-fetched truncated at the cutoff.
   */
  asOf?: string | null;
  /** Replay window start (ISO local datetime, null = any). */
  fromDate?: string | null;
  /** Re-fetch the chart truncated at the new as-of cutoff / window. */
  onAsOfChange?: (asOf: string | null, fromDate: string | null) => void;
}

/**
 * Full-page chart for inspecting a pattern at a readable size: real candles,
 * boundary trendlines, pivot markers, plus zoom/pan on an 80/20 split with a
 * narrow meta panel on the right. Stacks vertically below `lg`.
 *
 * The toolbar and body are shared with the `/chart/:symbol` page
 * (`PatternChartToolbar` / `PatternChartBody`); this component only owns the
 * fullscreen modal chrome. The TV chart is mounted only while open so
 * lightweight-charts initialises against a live ref.
 */
export function PatternFullscreenView({
  opened,
  onClose,
  docked = false,
  onMaximize,
  onPrev,
  onNext,
  positionLabel,
  onLive,
  symbol,
  hit,
  candles,
  overlays,
  trendLines,
  trendlinesView = "both",
  timeframe,
  timeframes,
  onTimeframeChange,
  loading = false,
  asOf = null,
  fromDate = null,
  onAsOfChange,
  hits,
  onSelectHit,
}: PatternFullscreenViewProps) {
  const title = hit
    ? `${hit.symbol} · ${hit.pattern_name}`
    : symbol
      ? symbol
      : "Pattern chart";

  const toolbar = (
    <PatternChartToolbar
      title={title}
      timeframe={timeframe}
      timeframes={timeframes}
      onTimeframeChange={onTimeframeChange}
      loading={loading}
      asOf={asOf}
      fromDate={fromDate}
      onAsOfChange={onAsOfChange}
    />
  );

  const body = (
    <PatternChartBody
      hit={hit}
      candles={candles}
      hits={hits}
      onSelectHit={onSelectHit}
      overlays={overlays}
      trendLines={trendLines}
      trendlinesView={trendlinesView}
      asOf={asOf}
      docked={docked}
      fill={docked}
    />
  );

  const stepper =
    onPrev || onNext ? (
      <Box
        className="mt-[2px] flex shrink-0 items-center gap-[2px]"
      >
        <Tooltip label="Previous pattern (↑)">
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Previous pattern"
            onClick={onPrev}
            data-testid="patterns-chart-prev"
          >
            <IconChevronLeft size={15} />
          </ActionIcon>
        </Tooltip>
        {positionLabel ? (
          <Text
            size="xs"
            c="dimmed"
            data-testid="patterns-chart-position"
            className="min-w-[38px] text-center tabular-nums"
          >
            {positionLabel}
          </Text>
        ) : null}
        <Tooltip label="Next pattern (↓)">
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Next pattern"
            onClick={onNext}
            data-testid="patterns-chart-next"
          >
            <IconChevronRight size={15} />
          </ActionIcon>
        </Tooltip>
      </Box>
    ) : null;

  if (docked) {
    return (
      <Box
        data-testid="patterns-chart-dock"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-fin border border-fin-border bg-fin-surface"
      >
        <Box
          className="flex min-w-0 shrink-0 items-start gap-1 border-b border-fin-border px-2 py-1"
        >
          <Box className="min-w-0 flex-1">{toolbar}</Box>
          {stepper}
          {asOf && onLive ? (
            <Tooltip label="Return to live data">
              <Button
                size="xs"
                variant="outline"
                onClick={onLive}
                data-testid="patterns-chart-live"
                className="mt-[2px] shrink-0"
              >
                Live
              </Button>
            </Tooltip>
          ) : null}
          {onMaximize ? (
            <Tooltip label="Expand to full screen">
              <ActionIcon
                size="xs"
                variant="subtle"
                aria-label="Expand chart"
                onClick={onMaximize}
                data-testid="patterns-chart-expand"
                className="mt-[2px]"
              >
                <IconArrowsMaximize size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip label="Close preview">
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label="Close chart preview"
              onClick={onClose}
              data-testid="patterns-chart-close"
              className="mt-[2px]"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </Box>
        <Box className="min-h-0 flex-1">{body}</Box>
      </Box>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Box
          className="flex w-full min-w-0 items-center gap-1"
        >
          <Box className="min-w-0 flex-1">{toolbar}</Box>
          {stepper}
        </Box>
      }
      fullScreen
      padding={0}
      data-testid="patterns-fullscreen-modal"
    >
      {body}
    </Modal>
  );
}
