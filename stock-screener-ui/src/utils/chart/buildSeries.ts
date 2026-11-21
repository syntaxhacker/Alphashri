import { CANDLESTICK_ITEM_STYLE } from "../chartUtils";
import { VOLUME_BULLISH, VOLUME_BEARISH } from "../../config/colors";
import type { ChartColors, MarkLineData, MarkAreaItem } from "./types";

/** A normalised candle row. */
export interface SeriesCandle {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** The renderer also accepts pre-built OHLC tuples and — when holidays insert
 *  gaps — placeholder string rows, so the union is deliberate. */
export type SeriesCandleInput = SeriesCandle | (number | string)[];

/** Each ECharts series carries a different shape and the test suite indexes it
 *  untyped, so the element type stays loose; the candle side is typed above. */
interface SeriesResult {
  series: any[];
}

function toOHLC(c: SeriesCandleInput): [number, number, number, number] {
  if (Array.isArray(c)) return c as [number, number, number, number];
  return [c.open, c.close, c.low, c.high];
}

function getVolume(c: SeriesCandleInput, i: number): [number, number, number] {
  if (Array.isArray(c)) return [i, 0, 0];
  return [i, c.volume, c.close >= c.open ? 1 : -1];
}

export function buildSeries(
  candles: SeriesCandleInput[],
  colors: ChartColors,
  showVolume: boolean,
  markLines?: MarkLineData[],
  markAreas?: MarkAreaItem[],
  times?: string[],
): SeriesResult {
  const ohlcData = candles.map((c) => toOHLC(c));

  const candleSeries: any = {
    name: "Price",
    type: "candlestick",
    data: ohlcData,
    itemStyle: CANDLESTICK_ITEM_STYLE,
    z: 2,
  };

  if (markLines && markLines.length > 0) {
    candleSeries.markLine = {
      symbol: ["none", "none"],
      data: markLines,
      label: { color: "inherit", fontSize: 11, formatter: "{b}" },
    };
  }

  if (markAreas && markAreas.length > 0 && times && times.length > 0) {
    candleSeries.markArea = {
      data: markAreas.map((ma) => {
        const item: any = {
          xAxis: ma.from,
          itemStyle: { color: ma.color },
        };
        if (ma.fromY != null) item.yAxis = ma.fromY;
        const endItem: any = {
          xAxis: ma.to,
        };
        if (ma.toY != null) endItem.yAxis = ma.toY;
        return [item, endItem];
      }),
    };
  }

  const series: any[] = [candleSeries];

  if (showVolume) {
    const volumeData = candles.map((c, i) => getVolume(c, i));
    series.push({
      name: "Volume",
      type: "bar",
      data: volumeData,
      xAxisIndex: 1,
      yAxisIndex: 1,
      itemStyle: {
        color: (params: { data: [number, number, number] }) =>
          params.data[2] === 1 ? VOLUME_BULLISH : VOLUME_BEARISH,
      },
      z: 1,
    });
  }

  return { series };
}
