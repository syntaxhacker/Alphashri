import { PIVOT_R1, PIVOT_PP, PIVOT_S1 } from "../config/colors";

export function buildPivotSeries(
  candles: Array<{ date: string }>,
  pivot_levels: Array<{ date: string; date_raw: string; pp: number; r1: number; s1: number }>,
): any[] {
  if (!pivot_levels || pivot_levels.length === 0) {
    return [];
  }

  const r1Map = new Map<string, number>();
  const s1Map = new Map<string, number>();
  const ppMap = new Map<string, number>();

  for (const level of pivot_levels) {
    const key = level.date_raw || level.date;
    r1Map.set(key, level.r1);
    s1Map.set(key, level.s1);
    ppMap.set(key, level.pp);
  }

  const r1Data = candles.map((c) => r1Map.get(c.date) ?? null);
  const s1Data = candles.map((c) => s1Map.get(c.date) ?? null);
  const ppData = candles.map((c) => ppMap.get(c.date) ?? null);

  return [
    {
      id: "pivot-r1",
      name: "R1",
      type: "line",
      data: r1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: PIVOT_R1, width: 1, type: "dashed" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:${PIVOT_R1}">R1: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
    {
      id: "pivot-pp",
      name: "PP",
      type: "line",
      data: ppData,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: PIVOT_PP, width: 1, type: "dotted" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:${PIVOT_PP}">PP: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
    {
      id: "pivot-s1",
      name: "S1",
      type: "line",
      data: s1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 4,
      lineStyle: { color: PIVOT_S1, width: 1, type: "dashed" },
      tooltip: {
        show: true,
        formatter: (params: any) =>
          params.value !== null
            ? `<span style="color:${PIVOT_S1}">S1: ₹${params.value.toFixed(2)}</span>`
            : "",
      },
    },
  ];
}

export function buildWeek52Series(
  candles: Array<{ date: string }>,
  week52_levels: Array<{ date: string; "52w_high": number }>,
  extendSeriesData: (data: any[]) => any[],
): any[] {
  if (!week52_levels || week52_levels.length === 0) return [];
  const data = extendSeriesData(
    candles.map((c) => {
      const level = week52_levels.find((l) => l.date === c.date);
      return level ? level["52w_high"] : null;
    }),
  );
  return [
    {
      id: "52w-high",
      name: "52W High",
      type: "line",
      data,
      showSymbol: false,
      silent: true,
      z: 5,
      lineStyle: { color: "#FFD700", width: 2, type: "dashed" },
    },
  ];
}

export function buildEmaSeries(
  ema_series: Array<{ label: string; color: string; data: any[] }>,
  extendSeriesData: (data: any[]) => any[],
  legendData: string[],
): any[] {
  if (!ema_series?.length) return [];
  const series: any[] = [];
  for (const ema of ema_series) {
    series.push({
      name: ema.label,
      type: "line",
      data: extendSeriesData(ema.data),
      showSymbol: false,
      connectNulls: true,
      silent: true,
      z: 5,
      lineStyle: { color: ema.color, width: 1.5 },
      tooltip: { show: true },
    });
    if (!legendData.includes(ema.label)) legendData.push(ema.label);
  }
  return series;
}
