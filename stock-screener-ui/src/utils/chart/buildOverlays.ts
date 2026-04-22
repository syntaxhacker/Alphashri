import type { UnifiedOverlay } from "./types";

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

  for (const overlay of overlays) {
    if (overlay.type === "line") {
      const lineData = extendSeriesData(
        candleSource.map((c) => {
          if (!overlay.levels.length) return null;
          const hasDates = overlay.levels.some((l) => l.date);
          if (hasDates) {
            const match = overlay.levels.find((l) => l.date && c.date && l.date === c.date);
            return match ? match.value : null;
          }
          return overlay.levels[0].value;
        }),
      );

      const showLabels = overlay.showLabel !== false;
      const value = overlay.levels[0]?.value;

      series.push({
        id: overlay.id,
        name: overlay.label,
        type: "line",
        data: lineData,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 5,
        lineStyle: {
          color: overlay.color,
          width: 1,
          type: overlay.dash ? overlay.dash : "solid",
        },
        tooltip: { show: true },
        ...(showLabels
          ? {
              label: {
                show: true,
                position: "end",
                formatter: `${value}`,
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
      });
    } else if (overlay.type === "box") {
      const topValue = overlay.levels.length > 0 ? overlay.levels[0].value : null;
      if (topValue == null) continue;

      const hasDates = overlay.levels.some((l) => l.date);
      const topData = extendSeriesData(
        candleSource.map((c) => {
          if (hasDates) {
            const match = overlay.levels.find((l) => l.date && c.date && l.date === c.date);
            return match ? match.value : null;
          }
          return overlay.levels[0].value;
        }),
      );

      series.push({
        id: `${overlay.id}_top`,
        name: overlay.label,
        type: "line",
        data: topData,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 4,
        lineStyle: { color: overlay.color, width: 0.5, opacity: 0.5, type: "dashed" },
      });
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
