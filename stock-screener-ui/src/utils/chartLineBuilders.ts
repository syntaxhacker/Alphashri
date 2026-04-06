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
