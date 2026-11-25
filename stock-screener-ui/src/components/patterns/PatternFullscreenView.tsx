import { ActionIcon, Box, Button, Modal, Text, Tooltip } from "@/ui";
import {
  IconArrowsMaximize,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconX,
} from "@/ui/icons";
import type {
  ChartCandle,
  ChartIndicators,
  PatternHitDTO,
  PatternOverlay,
  SRZone,
  TFSpec,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { PatternChartBody } from "./PatternChartBody";
import { PatternChartToolbar } from "./PatternChartToolbar";
import type { ChartMarket } from "@/utils/chart/time";

export interface PatternFullscreenViewProps {
  opened: boolean;
  onClose: () => void;
  /**
   * Render as a docked right-rail panel instead of a modal. The panel fills
   * its parent (`height: 100%`) — the caller owns width/position.
   */
  docked?: boolean;
  onMaximize?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  positionLabel?: string;
  onLive?: () => void;
  symbol?: string | null;
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  hits?: PatternHitDTO[];
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
  trendlinesView?: TrendlinesView;
  /** Indicator series from the chart payload, forwarded to the body/menu. */
  indicators?: ChartIndicators | null;
  /** Historical reaction zones from the chart payload. */
  srZones?: SRZone[];
  timeframe?: string | null;
  /** Timeframe ladder for the selector (falls back to the contract ladder). */
  timeframes?: TFSpec[];
  onTimeframeChange?: (timeframe: string) => void;
  loading?: boolean;
  asOf?: string | null;
  fromDate?: string | null;
  onAsOfChange?: (asOf: string | null, fromDate: string | null) => void;
  /** Chart endpoint failure code (`no_data`, `fetch_timeout`, …). */
  chartError?: string | null;
  chartNote?: string | null;
  /** Live quote from the market snapshot; the LTP line is omitted when null. */
  livePrice?: number | null;
  liveChange?: number | null;
  /** Exchange whose session defines axis/session dates (India by default). */
  market?: ChartMarket;
  /** Re-fetch the symbol chart, bypassing the in-memory chart cache. */
  onRefresh?: () => void;
}

export function PatternFullscreenView(props: PatternFullscreenViewProps) {
  const title = () => {
    const symbol = props.hit?.symbol ?? props.symbol;
    // The fullscreen header identifies the instrument *and* frame so the
    // toolbar context is readable before parsing the controls.
    if (symbol && props.timeframe) return `${symbol} · ${props.timeframe}`;
    if (props.hit) return `${props.hit.symbol} · ${props.hit.pattern_name}`;
    return props.symbol || "Pattern chart";
  };

  // Render functions, not stored JSX: Modal reads its `title` prop more than
  // once, and re-inserting the same pre-built node left the header empty.
  const renderToolbar = () => (
    <PatternChartToolbar
      title={title()}
      timeframe={props.timeframe}
      timeframes={props.timeframes}
      onTimeframeChange={props.onTimeframeChange}
      loading={props.loading ?? false}
      asOf={props.asOf ?? null}
      fromDate={props.fromDate ?? null}
      onAsOfChange={props.onAsOfChange}
    />
  );

  const renderBody = () => (
    <PatternChartBody
      hit={props.hit}
      candles={props.candles}
      hits={props.hits}
      onSelectHit={props.onSelectHit}
      overlays={props.overlays}
      trendLines={props.trendLines}
      trendlinesView={props.trendlinesView ?? "both"}
      timeframe={props.timeframe ?? null}
      indicators={props.indicators ?? null}
      srZones={props.srZones ?? []}
      asOf={props.asOf ?? null}
      docked={props.docked ?? false}
      fill={props.docked ?? false}
      chartError={props.chartError ?? null}
      chartNote={props.chartNote ?? null}
      loading={props.loading ?? false}
      livePrice={props.livePrice}
      liveChange={props.liveChange}
      market={props.market}
    />
  );

  const renderStepper = () =>
    props.onPrev || props.onNext ? (
      <Box className="mt-[2px] flex shrink-0 items-center gap-[2px]">
        <Tooltip label="Previous pattern (↑)">
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Previous pattern"
            onClick={props.onPrev}
            data-testid="patterns-chart-prev"
          >
            <IconChevronLeft size={14} />
          </ActionIcon>
        </Tooltip>
        {props.positionLabel ? (
          <Text
            size="xs"
            c="dimmed"
            data-testid="patterns-chart-position"
            className="min-w-[38px] text-center font-mono tabular-nums"
          >
            {props.positionLabel}
          </Text>
        ) : null}
        <Tooltip label="Next pattern (↓)">
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Next pattern"
            onClick={props.onNext}
            data-testid="patterns-chart-next"
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        </Tooltip>
      </Box>
    ) : null;

  const renderRefreshButton = () =>
    props.onRefresh ? (
      <Tooltip label="Refresh chart data">
        <ActionIcon
          size="xs"
          variant="subtle"
          aria-label="Refresh pattern data"
          loading={props.loading ?? false}
          onClick={props.onRefresh}
          data-testid="patterns-dock-refresh"
          className="mt-[2px] shrink-0"
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>
    ) : null;

  if (props.docked ?? false) {
    return (
      <Box
        data-testid="patterns-chart-dock"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-fin border border-fin-border bg-fin-surface"
      >
        <Box
          className="flex min-w-0 shrink-0 items-start gap-1 border-b border-fin-border px-2 py-1"
        >
          <Box className="min-w-0 flex-1">{renderToolbar()}</Box>
          {renderStepper()}
          {renderRefreshButton()}
          {props.asOf && props.onLive ? (
            <Tooltip label="Return to live data">
              <Button
                size="xs"
                variant="outline"
                onClick={props.onLive}
                data-testid="patterns-chart-live"
                className="mt-[2px] shrink-0"
              >
                Live
              </Button>
            </Tooltip>
          ) : null}
          {props.onMaximize ? (
            <Tooltip label="Expand to full screen">
              <ActionIcon
                size="xs"
                variant="subtle"
                aria-label="Expand chart"
                onClick={props.onMaximize}
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
              onClick={props.onClose}
              data-testid="patterns-chart-close"
              className="mt-[2px]"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </Box>
        <Box className="min-h-0 flex-1">{renderBody()}</Box>
      </Box>
    );
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      withCloseButton
      title={
        <Box
          className="flex w-full min-w-0 items-center gap-1"
        >
          <Box className="min-w-0 flex-1">{renderToolbar()}</Box>
          {renderStepper()}
          {renderRefreshButton()}
        </Box>
      }
      fullScreen
      padding={0}
      data-testid="patterns-fullscreen-modal"
    >
      {renderBody()}
    </Modal>
  );
}
