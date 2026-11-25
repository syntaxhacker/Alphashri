import { For, Show, type JSX } from "solid-js";
import type { IChartApi } from "lightweight-charts";
import * as palette from "@/ui/palette";
import { REPORT_FONT, REPORT_RADIUS } from "./reportTokens";

export interface OverlayLegendLine {
  label: string;
  color: string;
  /** Same array the engine plots; absent data cannot be verified and is kept. */
  data?: readonly (number | null)[];
}

/** Name only series that actually paint a point. With a short session the
 *  EMA20 seed never arrives, so advertising it would name a line that is not
 *  on screen next to the one visible amber segment. */
export function plottedOverlayLines(lines: readonly OverlayLegendLine[]): OverlayLegendLine[] {
  return lines.filter(
    (line) => line.data === undefined || line.data.some((v) => v != null && Number.isFinite(v)),
  );
}

export interface ChartAxisGeometry {
  axis: number;
  lane: number;
  gutter: number;
  shift: boolean;
}

/** A lone zero-range spot tick is a price tag, not a candle series: the engine
 *  has no bar to draw while the mark lines still paint levels. Never invent a
 *  wider bar to make the plot look populated. */
export function plottableCandleCount(candles: readonly { high: number; low: number }[]): number {
  return candles.filter(
    (c) => Number.isFinite(c.high) && Number.isFinite(c.low) && c.high > c.low,
  ).length;
}

/** The EMA/pattern lines are drawn by the engine without a name. A keyed legend
 *  makes the amber overlay discoverable without colour memory or a hover. */
export function ChartOverlayLegend(props: {
  lines: readonly OverlayLegendLine[];
  compact?: boolean;
}): JSX.Element {
  const shown = () => plottedOverlayLines(props.lines);
  return (
    <Show when={shown().length > 0}>
      <div
        data-testid="nifty-chart-overlay-legend"
        class="pointer-events-none absolute flex items-center"
        title={`Chart overlays: ${shown().map((line) => line.label).join(", ")} — computed on the displayed candles.`}
        style={{
          // TradingViewChart's overlay canvas sits at z-index 3; without a
          // higher layer the key is in the DOM but never painted.
          "z-index": 4,
          // Compact width has no free top lane: the gutter badges and the
          // cutoff tag own it. Drop the key below the badge stack instead.
          top: props.compact ? "64px" : "4px",
          // On wide charts the left gutter carries edge badges and the right
          // one owns the cutoff label; the centre is the only free lane.
          left: "50%",
          transform: "translateX(-50%)",
          gap: "8px",
          padding: "1px 4px",
          "max-width": "calc(100% - 12px)",
          "font-family": palette.MONO,
          "font-size": `${REPORT_FONT.micro}px`,
          "font-weight": 700,
          "line-height": "13px",
          "white-space": "nowrap",
          overflow: "hidden",
          color: palette.TEXT,
          background: palette.alpha(palette.SURFACE, 0.86),
          border: `1px solid ${palette.BORDER}`,
          "border-radius": `${REPORT_RADIUS.sm}px`,
        }}
      >
        <For each={shown()}>
          {(line) => (
            <span class="flex items-center" style={{ gap: "4px" }}>
              <span
                data-overlay-swatch
                aria-hidden="true"
                class="shrink-0"
                style={{ width: "10px", height: "2px", "background-color": line.color }}
              />
              <span>{line.label}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

/** The volume histogram is the only overlay series. Its "109K" tag stacked
 *  against the price tag at 390px; the bars still render, only the redundant
 *  tag is suppressed (as is the candle tag via `hideLastValueTag`). The live
 *  spot stays visible in the decision strip's HTML `NiftySpotValue` chip. */
function volumeSeriesOf(chart: IChartApi) {
  for (const pane of chart.panes?.() ?? []) {
    for (const series of pane.getSeries()) {
      if (series.seriesType() === "Histogram") return series;
    }
  }
  return null;
}

export function applyOverlayAxisGeometry(chart: IChartApi, g: ChartAxisGeometry): void {
  // The blank lane must match the CSS boundary or the rule floats over live bars.
  chart.timeScale().applyOptions({ rightOffsetPixels: g.lane });
  chart.priceScale("right").applyOptions({
    minimumWidth: g.axis,
    // Compact lanes rely on the overlap resolver: shift a tag, never clip "00".
    ...(g.shift ? { alignLabels: true, entireTextOnly: true } : {}),
  });
  // The volume value is in the tooltip; its axis tag collides with the price
  // label at both widths, so suppress it rather than overlay it.
  const volume = volumeSeriesOf(chart);
  if (volume && volume.options().lastValueVisible !== false) {
    volume.applyOptions({ lastValueVisible: false });
  }
}
