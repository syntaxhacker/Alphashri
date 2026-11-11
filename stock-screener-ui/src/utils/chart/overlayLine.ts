/**
 * Shared ECharts series scaffold for overlay line/box series.
 *
 * `buildBacktestChartOption` and `buildOverlays` both painted line and box
 * overlays with the same skeleton (`type: "line"`, `showSymbol: false`,
 * `connectNulls: false`, `silent: true`, `z`, `lineStyle.color`) but diverged
 * on `label`/`endLabel` and `dash` normalization. This builder owns the shared
 * scaffold so both callers render identical output; callers pass their own
 * `dash` (boolean for backtest, string/number[] for buildOverlays) and optional
 * label/endLabel/tooltip overrides.
 */
export interface OverlayLineOptions {
  id: string;
  name: string;
  data: (number | null)[];
  z: number;
  color: string;
  width?: number;
  opacity?: number;
  /** `boolean` (backtest) or `string | number[]` (buildOverlays) dash style. */
  dash?: boolean | string | number[];
  tooltip?: boolean;
  label?: Record<string, unknown>;
  endLabel?: Record<string, unknown>;
}

export function buildOverlayLineSeries(opts: OverlayLineOptions): any {
  const {
    id,
    name,
    data,
    z,
    color,
    width = 1,
    opacity,
    dash,
    tooltip = true,
    label,
    endLabel,
  } = opts;

  const lineStyle: Record<string, unknown> = { color, width };
  if (opacity !== undefined) lineStyle.opacity = opacity;
  if (dash !== undefined) {
    lineStyle.type = Array.isArray(dash) || typeof dash === "string" ? dash : dash ? "dashed" : "solid";
  } else {
    lineStyle.type = "solid";
  }

  const series: Record<string, unknown> = {
    id,
    name,
    type: "line",
    data,
    showSymbol: false,
    connectNulls: false,
    silent: true,
    z,
    lineStyle,
  };
  if (tooltip !== false) series.tooltip = { show: true };
  if (label !== undefined) series.label = label;
  if (endLabel !== undefined) series.endLabel = endLabel;
  return series;
}
