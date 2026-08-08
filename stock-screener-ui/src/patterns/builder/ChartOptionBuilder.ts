/**
 * ChartOptionBuilder — GoF Builder pattern for constructing ECharts option objects.
 *
 * The existing approach in chartLineBuilders.ts uses standalone functions
 * (buildPivotSeries, buildWeek52Series, buildEmaSeries) that return partial
 * series arrays, which callers must merge manually along with xAxis, yAxis,
 * tooltip, legend, and grid. This builder formalizes that composition into a
 * single fluent API, separating the construction of a complex ECharts option
 * from its representation.
 *
 * Usage:
 *   const option = new ChartOptionBuilder()
 *     .withCandles(candles)
 *     .withPivotLevels(pivots)
 *     .withEmaSeries(fast, slow)
 *     .withTradeMarkers(entries, exits)
 *     .withLegend(true)
 *     .build();
 */

import {
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_52W_HIGH,
  MARKER_ENTRY,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  MARKER_BORDER,
  BULLISH,
  BEARISH,
  VOLUME_BULLISH,
  VOLUME_BEARISH,
  TOOLTIP_DARK_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_DARK_TEXT,
  AXIS_DARK_LINE,
  AXIS_DARK_SPLIT,
  CHART_TEXT,
  TEXT_MUTED,
} from "../../ui/palette";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PivotLevel {
  date: string;
  pp: number;
  r1: number;
  s1: number;
}

interface Week52Level {
  date: string;
  "52w_high": number;
}

interface EmaSeriesDef {
  label: string;
  color: string;
  data: number[];
}

interface TradeEntry {
  date: string;
  price: number;
}

interface TradeExit {
  date: string;
  price: number;
  reason: string;
}

export class ChartOptionBuilder {
  private candles: Candle[] = [];
  private pivotLevels: PivotLevel[] = [];
  private week52Levels: Week52Level[] = [];
  private emaFast: EmaSeriesDef | null = null;
  private emaSlow: EmaSeriesDef | null = null;
  private entries: TradeEntry[] = [];
  private exits: TradeExit[] = [];
  private tooltipTrigger: "axis" | "item" = "axis";
  private legendEnabled = true;
  private titleText = "";

  withCandles(candles: Candle[]): this {
    this.candles = candles;
    return this;
  }

  withPivotLevels(pivotLevels: PivotLevel[]): this {
    this.pivotLevels = pivotLevels;
    return this;
  }

  withWeek52Line(levels: Week52Level[]): this {
    this.week52Levels = levels;
    return this;
  }

  withEmaSeries(
    fast: EmaSeriesDef,
    slow: EmaSeriesDef,
  ): this {
    this.emaFast = fast;
    this.emaSlow = slow;
    return this;
  }

  withTradeMarkers(entries: TradeEntry[], exits: TradeExit[]): this {
    this.entries = entries;
    this.exits = exits;
    return this;
  }

  withTooltip(trigger: "axis" | "item" = "axis"): this {
    this.tooltipTrigger = trigger;
    return this;
  }

  withLegend(enabled = true): this {
    this.legendEnabled = enabled;
    return this;
  }

  withTitle(title: string): this {
    this.titleText = title;
    return this;
  }

  reset(): this {
    this.candles = [];
    this.pivotLevels = [];
    this.week52Levels = [];
    this.emaFast = null;
    this.emaSlow = null;
    this.entries = [];
    this.exits = [];
    this.tooltipTrigger = "axis";
    this.legendEnabled = true;
    this.titleText = "";
    return this;
  }

  build(): Record<string, any> {
    const timeData = this.candles.map((c) => c.time);
    const series: Record<string, any>[] = [];

    series.push(...this.buildCandleSeries());
    series.push(...this.buildVolumeSeries());
    series.push(...this.buildPivotSeries());
    series.push(...this.buildWeek52Series());
    series.push(...this.buildEmaSeries());
    series.push(...this.buildTradeMarkerSeries());

    return {
      title: this.titleText
        ? { text: this.titleText, left: "center", textStyle: { fontSize: 14 } }
        : undefined,
      tooltip: {
        trigger: this.tooltipTrigger,
        backgroundColor: TOOLTIP_DARK_BG,
        borderColor: TOOLTIP_DARK_BORDER,
        textStyle: { color: TOOLTIP_DARK_TEXT, fontSize: 12 },
      },
      legend: this.legendEnabled
        ? { data: this.collectLegendNames(), bottom: 0, textStyle: { color: CHART_TEXT } }
        : undefined,
      grid: [
        { left: "6%", right: "6%", top: "8%", height: "62%" },
        { left: "6%", right: "6%", top: "76%", height: "14%" },
      ],
      xAxis: [
        {
          type: "category",
          data: timeData,
          gridIndex: 0,
          axisLine: { lineStyle: { color: AXIS_DARK_LINE } },
          splitLine: { show: false },
          axisLabel: { show: false },
        },
        {
          type: "category",
          data: timeData,
          gridIndex: 1,
          axisLine: { lineStyle: { color: AXIS_DARK_LINE } },
          splitLine: { show: false },
          axisLabel: { color: TEXT_MUTED, fontSize: 10, rotate: 45 },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          scale: true,
          splitLine: { lineStyle: { color: AXIS_DARK_SPLIT, type: "dashed" } },
          axisLabel: { color: TEXT_MUTED, fontSize: 10 },
        },
        {
          type: "value",
          gridIndex: 1,
          splitLine: { show: false },
          axisLabel: { color: TEXT_MUTED, fontSize: 10 },
        },
      ],
      series,
    };
  }

  /* ── private build helpers ── */

  private buildCandleSeries(): Record<string, any>[] {
    if (!this.candles.length) return [];
    return [
      {
        type: "candlestick",
        name: "Price",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: this.candles.map((c) => [c.open, c.close, c.low, c.high]),
        itemStyle: {
          color: BULLISH,
          color0: BEARISH,
          borderColor: BULLISH,
          borderColor0: BEARISH,
        },
        tooltip: {
          formatter: (params: any) => {
            const c = this.candles[params.dataIndex];
            if (!c) return "";
            return [
              `<b>${c.time}</b>`,
              `O: ${c.open.toFixed(2)}`,
              `H: ${c.high.toFixed(2)}`,
              `L: ${c.low.toFixed(2)}`,
              `C: ${c.close.toFixed(2)}`,
              `Vol: ${c.volume.toLocaleString()}`,
            ].join("<br/>");
          },
        },
      },
    ];
  }

  private buildVolumeSeries(): Record<string, any>[] {
    if (!this.candles.length) return [];
    return [
      {
        type: "bar",
        name: "Volume",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: this.candles.map((c) => ({
          value: c.volume,
          itemStyle: {
            color: c.close >= c.open ? VOLUME_BULLISH : VOLUME_BEARISH,
          },
        })),
        tooltip: {
          formatter: (params: any) => {
            const c = this.candles[params.dataIndex];
            if (!c) return "";
            return `<b>${c.time}</b><br/>Volume: ${c.volume.toLocaleString()}`;
          },
        },
      },
    ];
  }

  private buildPivotSeries(): Record<string, any>[] {
    if (!this.pivotLevels.length) return [];

    const r1Map = new Map<string, number>();
    const ppMap = new Map<string, number>();
    const s1Map = new Map<string, number>();

    for (const l of this.pivotLevels) {
      r1Map.set(l.date, l.r1);
      ppMap.set(l.date, l.pp);
      s1Map.set(l.date, l.s1);
    }

    const mapTo = (fn: (date: string) => number | null) =>
      this.candles.map((c) => fn(c.time) ?? null);

    return [
      {
        id: "pivot-r1",
        name: "R1",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: mapTo((d) => r1Map.get(d) ?? null),
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 4,
        lineStyle: { color: PIVOT_R1, width: 1, type: "dashed" },
        tooltip: {
          formatter: (params: any) =>
            params.value != null
              ? `<span style="color:${PIVOT_R1}">R1: ₹${Number(params.value).toFixed(2)}</span>`
              : "",
        },
      },
      {
        id: "pivot-pp",
        name: "PP",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: mapTo((d) => ppMap.get(d) ?? null),
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 4,
        lineStyle: { color: PIVOT_PP, width: 1, type: "dotted" },
        tooltip: {
          formatter: (params: any) =>
            params.value != null
              ? `<span style="color:${PIVOT_PP}">PP: ₹${Number(params.value).toFixed(2)}</span>`
              : "",
        },
      },
      {
        id: "pivot-s1",
        name: "S1",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: mapTo((d) => s1Map.get(d) ?? null),
        showSymbol: false,
        connectNulls: false,
        silent: true,
        z: 4,
        lineStyle: { color: PIVOT_S1, width: 1, type: "dashed" },
        tooltip: {
          formatter: (params: any) =>
            params.value != null
              ? `<span style="color:${PIVOT_S1}">S1: ₹${Number(params.value).toFixed(2)}</span>`
              : "",
        },
      },
    ];
  }

  private buildWeek52Series(): Record<string, any>[] {
    if (!this.week52Levels.length) return [];
    const data = this.candles.map((c) => {
      const match = this.week52Levels.find((l) => l.date === c.time);
      return match ? match["52w_high"] : null;
    });
    return [
      {
        id: "52w-high",
        name: "52W High",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data,
        showSymbol: false,
        silent: true,
        z: 5,
        lineStyle: { color: PIVOT_52W_HIGH, width: 2, type: "dashed" },
        tooltip: {
          formatter: (params: any) =>
            params.value != null
              ? `<span style="color:${PIVOT_52W_HIGH}">52W High: ₹${Number(params.value).toFixed(2)}</span>`
              : "",
        },
      },
    ];
  }

  private buildEmaSeries(): Record<string, any>[] {
    const series: Record<string, any>[] = [];
    if (this.emaFast) {
      series.push(this.makeEmaLine(this.emaFast));
    }
    if (this.emaSlow) {
      series.push(this.makeEmaLine(this.emaSlow));
    }
    return series;
  }

  private makeEmaLine(def: EmaSeriesDef): Record<string, any> {
    return {
      name: def.label,
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: def.data,
      showSymbol: false,
      connectNulls: true,
      silent: true,
      z: 5,
      lineStyle: { color: def.color, width: 1.5 },
      tooltip: {
        formatter: (params: any) =>
          params.value != null
            ? `<span style="color:${def.color}">${def.label}: ${Number(params.value).toFixed(2)}</span>`
            : "",
      },
    };
  }

  private buildTradeMarkerSeries(): Record<string, any>[] {
    if (!this.entries.length && !this.exits.length) return [];

    const markPointData: Record<string, any>[] = [];

    for (const e of this.entries) {
      const idx = this.candles.findIndex((c) => c.time === e.date);
      if (idx === -1) continue;
      markPointData.push({
        name: "Entry",
        coord: [idx, e.price],
        symbol: "triangle",
        symbolSize: 18,
        symbolRotate: 180,
        itemStyle: { color: MARKER_ENTRY, borderColor: MARKER_BORDER, borderWidth: 1 },
        label: {
          show: true,
          position: "top",
          distance: 6,
          formatter: "Entry",
          color: MARKER_ENTRY,
          fontSize: 10,
          fontWeight: "bold",
        },
      });
    }

    for (const ex of this.exits) {
      const idx = this.candles.findIndex((c) => c.time === ex.date);
      if (idx === -1) continue;
      const exitColor = this.exitColor(ex.reason);
      const symbol = ex.reason === "EOD" || ex.reason === "MAX_HOLDING" ? "diamond" : "circle";
      markPointData.push({
        name: "Exit",
        coord: [idx, ex.price],
        symbol,
        symbolSize: 16,
        itemStyle: { color: exitColor, borderColor: MARKER_BORDER, borderWidth: 1 },
        label: {
          show: true,
          position: "bottom",
          distance: 6,
          formatter: ex.reason || "Exit",
          color: exitColor,
          fontSize: 10,
          fontWeight: "bold",
        },
      });
    }

    if (!markPointData.length) return [];

    return [
      {
        type: "scatter",
        name: "Trades",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: [],
        markPoint: {
          data: markPointData,
          animation: false,
        },
        tooltip: { show: false },
        z: 10,
      },
    ];
  }

  private exitColor(reason: string): string {
    switch (reason) {
      case "TP":
        return MARKER_TP;
      case "SL":
        return MARKER_SL;
      case "EOD":
      case "FORCE_CLOSE":
        return MARKER_EOD;
      default:
        return MARKER_EOD;
    }
  }

  private collectLegendNames(): string[] {
    const names: string[] = [];
    if (this.candles.length) names.push("Price", "Volume");
    if (this.pivotLevels.length) names.push("R1", "PP", "S1");
    if (this.week52Levels.length) names.push("52W High");
    if (this.emaFast) names.push(this.emaFast.label);
    if (this.emaSlow) names.push(this.emaSlow.label);
    if (this.entries.length || this.exits.length) names.push("Trades");
    return names;
  }
}
