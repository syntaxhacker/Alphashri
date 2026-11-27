import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { ActionIcon, Button, SegmentedControl, Text } from "@/ui";
import * as palette from "@/ui/palette";
import {
  REPORT_CONTROL_LABEL_CLASS,
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
} from "./reportTokens";
import {
  CHART_CONTROL_LABEL_STYLE,
  CHART_HEADER_METRICS,
  CHART_SIZE_OPTIONS,
  CHART_SOURCE_OPTIONS,
  CHART_TF_OPTIONS,
  type ChartSize,
  type ChartTimeframe,
} from "./NiftyChartPanel.constants";
import type { FeedView } from "./NiftyChartPanel.annotations";
import type { ChartSource } from "./niftyReportStore";

/** A report window can be 240px wide inside a desktop monitor, so neither the
 *  axis reservation nor the header caption may key off the viewport. */
export const NARROW_CONTAINER_PX = 320;

export function useNarrowContainer(getHost: () => HTMLElement | null | undefined) {
  const [narrow, setNarrow] = createSignal(false);
  onMount(() => {
    const host = getHost();
    if (!host) return;
    const apply = (width: number) =>
      setNarrow(Number.isFinite(width) && width > 0 && width < NARROW_CONTAINER_PX);
    apply(host.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === host) ?? entries[0];
      apply(entry?.contentRect.width ?? 0);
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  return narrow;
}

interface ChartTitleProps {
  view: "chart" | "depth";
  symbol: string;
  feedView: FeedView | null;
  eventCount: number;
}

export function ChartTitle(props: ChartTitleProps) {
  return (
    <span
      data-testid="nifty-chart-title"
      data-header-role="title"
      class="inline-flex items-center gap-2 whitespace-nowrap shrink-0 max-[640px]:whitespace-normal max-[640px]:shrink"
      style={{
        "font-size": `${CHART_HEADER_METRICS.titleSize}px`,
        "font-weight": REPORT_FONT_WEIGHT.extrabold,
        "letter-spacing": REPORT_LETTER_SPACING.wide,
        "line-height": REPORT_LINE_HEIGHT.snug,
        "margin-right": `${CHART_HEADER_METRICS.gap}px`,
      }}
    >
      {props.view === "depth" ? `${props.symbol} depth map` : `${props.symbol} chart`}
      <Show when={props.feedView}>
        {(view) => (
          <Text
            data-testid="nifty-fyers-feed"
            data-state={view().state}
            size="xs"
            fw={700}
            span
            title={view().title}
            class="whitespace-nowrap max-[640px]:whitespace-normal"
            style={{
              color: view().color,
              "font-size": `${CHART_HEADER_METRICS.metaSize}px`,
              "font-weight": REPORT_FONT_WEIGHT.bold,
              "letter-spacing": REPORT_LETTER_SPACING.normal,
              "line-height": 1,
            }}
          >
            {view().label}
          </Text>
        )}
      </Show>
      <Show when={props.eventCount > 0}>
        <Text
          data-testid="nifty-chart-event-badge"
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": 700,
            "letter-spacing": "0.4em",
            "text-transform": "uppercase",
            color: palette.WARNING,
          }}
        >
          {props.eventCount} event{props.eventCount === 1 ? "" : "s"}
        </Text>
      </Show>
    </span>
  );
}

interface ChartControlsProps {
  isMobile: boolean;
  chartSource: ChartSource;
  chartTf: ChartTimeframe;
  chartSize: ChartSize;
  controlsOpen: boolean;
  onToggleControls: () => void;
  onSourceChange: (v: string) => void;
  onTfChange: (v: string) => void;
  onSizeChange: (v: string) => void;
  scanLoading: boolean;
  onScanPatterns: () => void;
  asOfLabel: string;
  asOfBoundary: string;
  onExpand?: () => void;
  symbol: string;
}

export function ChartControls(props: ChartControlsProps) {
  let root: HTMLElement | undefined;
  const narrow = useNarrowContainer(
    () => root?.closest("[data-compact-card-header]") ?? root?.parentElement ?? root,
  );
  const optionsLabel = () => (props.controlsOpen ? "Hide chart options" : "Chart options");
  const optionsCaption = () =>
    narrow() ? "⋯" : props.controlsOpen ? "HIDE OPTIONS" : "CHART OPTIONS";
  const sourceToggle = () => (
    <SegmentedControl
      data-testid="nifty-chart-source"
      value={props.chartSource}
      onChange={(v: string) => props.onSourceChange(v)}
      data={CHART_SOURCE_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const timeframeToggle = () => (
    <SegmentedControl
      data-testid="nifty-tf-toggle"
      value={props.chartTf}
      onChange={(v: string) => props.onTfChange(v)}
      data={CHART_TF_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const sizeToggle = () => (
    <SegmentedControl
      data-testid="nifty-chart-size"
      value={props.chartSize}
      onChange={(v: string) => props.onSizeChange(v)}
      data={CHART_SIZE_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const patternButton = () => (
    <Button
      data-testid="nifty-patterns-scan"
      size="xs"
      variant="subtle"
      onClick={props.onScanPatterns}
      disabled={props.scanLoading}
      title={`Run the chart-pattern detector on ${props.symbol} ${props.chartTf}`}
      style={{ "min-width": "0px", "padding-left": "6px", "padding-right": "6px", "padding-top": "0px", "padding-bottom": "0px", "height": "20px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800, "letter-spacing": "0.06em" }}
    >
      {props.scanLoading ? "…" : "PATTERNS"}
    </Button>
  );
  const expandButton = () => (
    <Show when={props.onExpand}>
      <ActionIcon
        data-testid="nifty-chart-expand"
        aria-label="Expand chart fullscreen"
        title="Fullscreen (F)"
        size={20}
        onClick={props.onExpand}
        style={{ padding: "1px", color: palette.TEXT_MUTED }}
      >
        <Text span size="xs" fw={700} style={{ "font-size": `${REPORT_FONT.body}px`, "line-height": 1 }}>
          ⤢
        </Text>
      </ActionIcon>
    </Show>
  );
  /** Data-cutoff readout, not a control: the time the populated session ends. */
  const asOfChip = () => (
    <Text
      data-testid="nifty-chart-asof"
      data-header-role="asof"
      span
      c="dimmed"
      title={props.asOfBoundary || "No chart data"}
      class="whitespace-nowrap shrink-0"
      style={{
        "font-size": `${CHART_HEADER_METRICS.metaSize}px`,
        "font-weight": REPORT_FONT_WEIGHT.semibold,
        "letter-spacing": REPORT_LETTER_SPACING.normal,
      }}
    >
      AS OF {props.asOfLabel}
    </Text>
  );
  /** Size + pattern actions are secondary: desktop keeps them behind a
   *  disclosure, mobile behind the existing chart-options row. */
  const primaryControls = () => (
    <>
      {timeframeToggle()}
      {asOfChip()}
      {expandButton()}
    </>
  );
  const secondaryControls = () => (
    <>
      {sizeToggle()}
      {patternButton()}
    </>
  );

  return (
    <Show
      when={props.isMobile}
      fallback={
        // Primary row: source · timeframe · as-of · expand. Size and
        // pattern actions sit behind a disclosure so the header reads as
        // one decision, not a wall of equal-weight controls.
        <div ref={(element) => (root = element)} class="flex flex-col items-end min-w-0" style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}>
          <div
            data-testid="nifty-chart-controls-desktop"
            class="flex flex-1 min-w-0 items-center justify-end overflow-x-auto"
            style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}
          >
            <div class="min-w-0 overflow-x-auto">{sourceToggle()}</div>
            <span aria-hidden="true" class="shrink-0 h-[16px] w-px bg-fin-border" />
            {primaryControls()}
            <Button
              data-testid="nifty-chart-controls-more-desktop"
              size="xs"
              variant="subtle"
              aria-expanded={props.controlsOpen}
              aria-controls="nifty-chart-controls-extra-desktop"
              aria-label={optionsLabel()}
              title={optionsLabel()}
              className="shrink-0"
              onClick={props.onToggleControls}
              style={{ height: "22px", "min-height": "22px", "min-width": narrow() ? "22px" : undefined, padding: narrow() ? "0 2px" : "0 6px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800 }}
            >
              {optionsCaption()}
            </Button>
          </div>
          <div
            id="nifty-chart-controls-extra-desktop"
            data-testid="nifty-chart-controls-extra-desktop"
            class="flex flex-wrap items-center justify-end min-w-0"
            style={{ gap: `${CHART_HEADER_METRICS.gap}px`, display: props.controlsOpen ? "flex" : "none" }}
          >
            {secondaryControls()}
          </div>
        </div>
      }
    >
      <div
        ref={(element) => (root = element)}
        data-testid="nifty-chart-controls-mobile"
        className="flex flex-col items-stretch min-w-0"
        style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}
      >
        <div className="flex items-center justify-end min-w-0" style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}>
          <div className="min-w-0 flex-1 overflow-x-auto">{sourceToggle()}</div>
          <Button
            data-testid="nifty-chart-controls-more"
            className="shrink-0"
            size="xs"
            variant="subtle"
            aria-expanded={props.controlsOpen}
            aria-controls={props.controlsOpen ? "nifty-chart-controls-extra" : undefined}
            aria-label={optionsLabel()}
            title={optionsLabel()}
            onClick={props.onToggleControls}
            style={{ height: "26px", "min-height": "26px", "min-width": narrow() ? "26px" : "56px", padding: narrow() ? "0 2px" : "0 6px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800 }}
          >
            {optionsCaption()}
          </Button>
        </div>
        <Show when={props.controlsOpen}>
          <div
            id="nifty-chart-controls-extra"
            data-testid="nifty-chart-controls-extra"
            className="flex flex-wrap items-center justify-end min-w-0"
            style={{ gap: `${CHART_HEADER_METRICS.gap}px`, "padding-top": `${CHART_HEADER_METRICS.gap}px` }}
          >
            {primaryControls()}
            {secondaryControls()}
          </div>
        </Show>
      </div>
    </Show>
  );
}
