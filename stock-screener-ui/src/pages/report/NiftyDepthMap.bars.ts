import * as palette from "@/ui/palette";
import type { NiftyReport } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import { REPORT_FONT } from "./reportTokens";
import { fmtStrike, formatOiCompact, signedOiText } from "./NiftyDepthMap.format";
import {
  depthKey,
  oiChangeByStrike,
  topOiLabelStrikes,
  type DepthRow,
  type LevelLine,
} from "./NiftyDepthMap.geometry";

type DepthSeries = Record<string, unknown>;

/** Level tags live on the candle grid: it owns the only price value axis left.
 * A category axis cannot place arbitrary Spot/MP/Hi/Lo levels. */
export function candleSeries(candles: ReplayCandle[], lines: LevelLine[]): DepthSeries {
  const lineData = lines.map((l) => ({
    name: l.name,
    yAxis: l.value,
    lineStyle: { color: l.color, type: l.type, width: l.width },
    label: { color: l.color, position: "insideEndTop", formatter: l.name },
  }));
  return {
    name: "Nifty 15m",
    type: "candlestick",
    xAxisIndex: 0,
    yAxisIndex: 0,
    data: candles.map((c) => [Number(c.open), Number(c.close), Number(c.low), Number(c.high)]),
    itemStyle: {
      color: palette.POSITIVE,
      color0: palette.NEGATIVE,
      "border-color": palette.POSITIVE,
      borderColor0: palette.NEGATIVE,
    },
    markLine: {
      symbol: "none",
      silent: true,
      label: { "font-size": `${REPORT_FONT.micro}px`, formatter: "{b}" },
      data: lineData,
    },
  };
}

/** Diverging bars: dim 0 (OI, negative = left) maps to the value x-axis,
 * dim 1 (strike) to the category y-axis. */
export function ceBarSeries(rows: DepthRow[]): DepthSeries {
  return {
    name: "CE OI",
    type: "bar",
    xAxisIndex: 1,
    yAxisIndex: 1,
    barCategoryGap: "45%",
    barMaxWidth: 16,
    encode: { x: 0, y: 1 },
    data: rows.map((r) => [-r.ceOi, depthKey(r.strike)]),
    itemStyle: { color: palette.NEGATIVE, "border-radius": [2, 0, 0, 2] },
  };
}

export function peBarSeries(rows: DepthRow[]): DepthSeries {
  const labelSet = new Set<number>(topOiLabelStrikes(rows));
  const rowByStrike = new Map<number, DepthRow>(rows.map((r) => [r.strike, r]));
  return {
    name: "PE OI",
    type: "bar",
    xAxisIndex: 1,
    yAxisIndex: 1,
    barCategoryGap: "45%",
    barMaxWidth: 16,
    encode: { x: 0, y: 1 },
    data: rows.map((r) => [r.peOi, depthKey(r.strike)]),
    itemStyle: { color: palette.POSITIVE, "border-radius": [0, 2, 2, 0] },
    label: {
      show: true,
      position: "right",
      "font-size": `${REPORT_FONT.micro}px`,
      color: palette.CHART_MUTED,
      formatter: (p: { value?: unknown }) => {
        const strike = Array.isArray(p.value) ? Number((p.value as number[])[1]) : NaN;
        if (!labelSet.has(strike)) return "";
        const row = rowByStrike.get(strike);
        return row ? formatOiCompact(row.ceOi + row.peOi) : "";
      },
    },
  };
}

/** Dominance markers sit on the depth grid: x = total strike OI (value axis),
 * y = strike (category axis) — explicit encode below. */
export function dominanceSeries(rows: DepthRow[]): [DepthSeries, DepthSeries] {
  const ceDom = rows.filter((r) => r.ceOi > r.peOi).map((r) => [r.ceOi + r.peOi, depthKey(r.strike)]);
  const peDom = rows.filter((r) => r.peOi > r.ceOi).map((r) => [r.ceOi + r.peOi, depthKey(r.strike)]);
  return [
    {
      name: "CE over PE",
      type: "scatter",
      xAxisIndex: 1,
      yAxisIndex: 1,
      symbol: "diamond",
      symbolSize: 6,
      label: { show: false },
      z: 10,
      encode: { x: 0, y: 1 },
      data: ceDom,
      itemStyle: { color: palette.NEGATIVE },
    },
    {
      name: "PE over CE",
      type: "scatter",
      xAxisIndex: 1,
      yAxisIndex: 1,
      symbol: "circle",
      symbolSize: 6,
      label: { show: false },
      z: 10,
      encode: { x: 0, y: 1 },
      data: peDom,
      itemStyle: { color: palette.POSITIVE },
    },
  ];
}

export function depthTooltip(rows: DepthRow[], report: NiftyReport) {
  const rowByStrike = new Map<number, DepthRow>(rows.map((r) => [r.strike, r]));
  const chgByStrike = oiChangeByStrike(report);
  return (p: unknown) => {
    const param = p as {
      seriesName?: string;
      name?: string;
      data?: unknown;
      value?: unknown;
    } | null;
    if (!param) return "";
    if (param.seriesName === "Nifty 15m" && Array.isArray(param.data)) {
      const [o, c, l, h] = param.data as number[];
      return `${param.name ?? ""}<br/>O ${o} H ${h} L ${l} C ${c}`;
    }
    if ((param.seriesName === "CE OI" || param.seriesName === "PE OI") && Array.isArray(param.value)) {
      const [, strike] = param.value as number[];
      const row = rowByStrike.get(Number(strike));
      if (!row) return "";
      const chg = chgByStrike.get(row.strike) ?? 0;
      return (
        `${fmtStrike(row.strike)}<br/>` +
        `CE OI ${formatOiCompact(row.ceOi)}<br/>` +
        `PE OI ${formatOiCompact(row.peOi)}<br/>` +
        `Total ${formatOiCompact(row.ceOi + row.peOi)}<br/>` +
        `OI Chg ${signedOiText(chg)}`
      );
    }
    if ((param.seriesName === "CE over PE" || param.seriesName === "PE over CE") && Array.isArray(param.value)) {
      const [, strike] = param.value as number[];
      return `${fmtStrike(Number(strike))} — ${param.seriesName}`;
    }
    return "";
  };
}
