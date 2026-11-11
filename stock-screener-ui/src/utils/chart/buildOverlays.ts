import type { UnifiedOverlay } from "./types";
import { buildOverlayLineSeries } from "./overlayLine";

/** Shared box-overlay skeleton: a thin dashed line with no tooltip or labels.
 *
 * `buildOverlays` and `buildBacktestChartOption` both painted box overlays with
 * this identical `buildOverlayLineSeries` skeleton; only the data mapping
 * differs (levels array + `extendSeriesData` here, `overlay.levels.top` via
 * `mapOverlayDateValues` there), so data stays with the caller and the
 * options object lives here.
 */
export function buildOverlayBoxSeries(
  id: string,
  name: string,
  data: (number | null)[],
  color: string,
): any {
  return buildOverlayLineSeries({
    id,
    name,
    data,
    z: 4,
    color,
    width: 0.5,
    opacity: 0.5,
    dash: true,
    tooltip: false,
  });
}

export function buildOverlays(
  overlays: UnifiedOverlay[],
  candles: { date?: string; time: string }[],
  times: string[],
  extendSeriesData: (data: (number | null)[]) => (number | null)[],
  emaData?: { label: string; color: string; data: (number | null)[] }[],
  rawCandles?: { date?: string; time: string }[],
): any[] {
  const candleSource = rawCandles || candles;
  const series: any[] = [];

  function mapLevelValues(overlay: UnifiedOverlay) {
    if (!overlay.levels.length) return candleSource.map(() => null);
    const hasDates = overlay.levels.some((l) => l.date);
    return candleSource.map((c) => {
      if (hasDates) {
        const match = overlay.levels.find((l) => l.date && c.date && l.date === c.date);
        return match ? match.value : null;
      }
      return overlay.levels[0].value;
    });
  }

  for (const overlay of overlays) {
    if (overlay.type === "line") {
      const lineData = extendSeriesData(mapLevelValues(overlay)!);

      const showLabels = overlay.showLabel !== false;

      series.push(
        buildOverlayLineSeries({
          id: overlay.id,
          name: overlay.label,
          data: lineData,
          z: 5,
          color: overlay.color,
          width: 1,
          dash: overlay.dash,
          tooltip: true,
          ...(showLabels
            ? {
                label: {
                  show: true,
                  position: "end",
                  formatter: `${overlay.levels[0]?.value}`,
                  fontSize: 10,
                  color: overlay.color,
                  fontFamily: "monospace",
                },
                endLabel: {
                  show: true,
                  formatter: overlay.label,
                  fontSize: 9,
                  color: overlay.color,
                  fontFamily: "monospace",
                },
              }
            : {}),
        }),
      );
    } else if (overlay.type === "box") {
      const topValue = overlay.levels.length > 0 ? overlay.levels[0].value : null;
      if (topValue == null) continue;

      const topData = extendSeriesData(mapLevelValues(overlay)!);

      series.push(
        buildOverlayBoxSeries(`${overlay.id}_top`, overlay.label, topData, overlay.color),
      );
    }
  }

  if (emaData) {
    for (const ema of emaData) {
      series.push({
        name: ema.label,
        type: "line",
        data: extendSeriesData(ema.data),
        showSymbol: false,
        connectNulls: true,
        smooth: true,
        silent: true,
        z: 5,
        lineStyle: { color: ema.color, width: 1.5 },
        tooltip: { show: true },
      });
    }
  }

  return series;
}
