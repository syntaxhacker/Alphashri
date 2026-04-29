import type { UnifiedTrade, MarkerConfig } from "./types";

export function getMarkerConfigs(): MarkerConfig[] {
  return [
    {
      name: "Entry",
      filter: (_t: UnifiedTrade) => true,
      color: "#00FFFF",
      symbol: "triangle",
      size: 18,
      rotate: 180,
    },
    {
      name: "TP",
      filter: (t: UnifiedTrade) => t.exit_reason === "TP",
      color: "#FFFF00",
      symbol: "circle",
      size: 16,
    },
    {
      name: "SL",
      filter: (t: UnifiedTrade) => t.exit_reason === "SL",
      color: "#FF00FF",
      symbol: "circle",
      size: 16,
    },
    {
      name: "EOD",
      filter: (t: UnifiedTrade) => t.exit_reason === "EOD",
      color: "#FFA500",
      symbol: "diamond",
      size: 16,
    },
    {
      name: "Trailing",
      filter: (t: UnifiedTrade) => t.exit_reason === "TRAILING_STOP",
      color: "#9C27B0",
      symbol: "circle",
      size: 16,
    },
    {
      name: "MaxHold",
      filter: (t: UnifiedTrade) => t.exit_reason === "MAX_HOLDING",
      color: "#FF9800",
      symbol: "diamond",
      size: 16,
    },
    {
      name: "52W",
      filter: (t: UnifiedTrade) => t.exit_reason === "NEW_52W_HIGH",
      color: "#00BCD4",
      symbol: "circle",
      size: 16,
    },
  ];
}

function applyXAxisMap(idx: number, candleToXAxis?: Map<number, number>): number {
  return candleToXAxis?.get(idx) ?? idx;
}

function lookupTimeIndex(
  key: string,
  times: string[],
  timeToIndex: Map<string, number>,
): number | undefined {
  const exact = timeToIndex.get(key);
  if (exact !== undefined) return exact;

  let best = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= key) best = i;
    else break;
  }
  return best >= 0 ? timeToIndex.get(times[best]) : times.length > 0 ? 0 : undefined;
}

function findCandleIdx(
  trade: UnifiedTrade,
  times: string[],
  timeToIndex: Map<string, number>,
  candleToXAxis?: Map<number, number>,
): number | undefined {
  if (trade.candle_idx !== undefined) {
    return applyXAxisMap(trade.candle_idx, candleToXAxis);
  }
  return lookupTimeIndex(trade.entry_time.substring(0, 16), times, timeToIndex);
}

function findExitIdx(
  trade: UnifiedTrade,
  times: string[],
  timeToIndex: Map<string, number>,
  candleToXAxis?: Map<number, number>,
): number | undefined {
  if (!trade.exit_time) return undefined;
  if (trade.exit_candle_idx !== undefined) {
    return applyXAxisMap(trade.exit_candle_idx, candleToXAxis);
  }
  return lookupTimeIndex(trade.exit_time.substring(0, 16), times, timeToIndex);
}

function getEntrySymbol(trade: UnifiedTrade): { symbol: string; rotate?: number } {
  if (trade.side === "SELL") return { symbol: "triangleRotated" };
  return { symbol: "triangle", rotate: 180 };
}

export function buildTradeMarkers(
  trades: UnifiedTrade[],
  candles: { time: string }[],
  highlightedTradeId?: number | null,
  showAllTrades?: boolean,
  candleToXAxis?: Map<number, number>,
): any[] {
  const times: string[] = [];
  const timeToIndex = new Map<string, number>();

  candles.forEach((c, i) => {
    const key = c.time.substring(0, 16);
    if (!timeToIndex.has(key)) {
      timeToIndex.set(key, i);
      times.push(key);
    }
  });

  const configs = getMarkerConfigs();
  const entryConfig = configs[0];
  const exitConfigs = configs.slice(1);

  const hasHighlight = highlightedTradeId != null;
  const filtered =
    hasHighlight && !showAllTrades ? trades.filter((t) => t.id === highlightedTradeId) : trades;
  console.log("[buildTradeMarkers]", {
    highlightedTradeId,
    showAllTrades,
    hasHighlight,
    totalTrades: trades.length,
    filteredCount: filtered.length,
    filteredIds: filtered.map((t) => t.id),
  });

  const entryMarkers: any[] = [];
  const exitMarkersByConfig: Map<string, any[]> = new Map();
  const entryIdxMap = new Map<number, number>();

  for (const config of exitConfigs) {
    exitMarkersByConfig.set(config.name, []);
  }

  for (const trade of filtered) {
    const isHighlighted = hasHighlight && trade.id === highlightedTradeId;
    const entryIdx = findCandleIdx(trade, times, timeToIndex, candleToXAxis);

    if (entryIdx !== undefined) {
      entryIdxMap.set(trade.id, entryIdx);
      const { symbol, rotate } = getEntrySymbol(trade);

      entryMarkers.push({
        value: [entryIdx, trade.entry_price],
        itemStyle: {
          color: isHighlighted ? "#FFD700" : entryConfig.color,
          borderColor: "#FFFFFF",
          borderWidth: isHighlighted ? 3 : 2,
        },
        symbol,
        symbolSize: isHighlighted ? 26 : entryConfig.size,
        symbolRotate: rotate,
        trade,
        trade_id: trade.id,
        ...(isHighlighted
          ? {
              label: {
                show: true,
                formatter: `#${trade.id}`,
                position: "top",
                color: "#FFD700",
                fontWeight: "bold",
                fontSize: 12,
              },
            }
          : {}),
      });
    }

    if (trade.exit_price != null && trade.exit_time) {
      const exitIdx = findExitIdx(trade, times, timeToIndex, candleToXAxis);
      if (exitIdx !== undefined) {
        let matchedConfig: MarkerConfig | undefined;
        for (const config of exitConfigs) {
          if (config.filter(trade)) {
            matchedConfig = config;
            break;
          }
        }

        const exitColor = matchedConfig
          ? isHighlighted
            ? "#FFD700"
            : matchedConfig.color
          : isHighlighted
            ? "#FFD700"
            : "#FF1744";

        const exitSymbol = matchedConfig?.symbol || "circle";
        const exitSize = isHighlighted ? 24 : matchedConfig?.size || 16;

        const entryIdxForTrade = entryIdxMap.get(trade.id);
        const isSameCandle = entryIdxForTrade !== undefined && entryIdxForTrade === exitIdx;

        const exitMarker: any = {
          value: [exitIdx, trade.exit_price],
          symbol: exitSymbol,
          symbolSize: exitSize,
          symbolOffset: isSameCandle ? [0, 20] : [0, 0],
          itemStyle: {
            color: exitColor,
            borderColor: "#FFFFFF",
            borderWidth: isHighlighted ? 3 : 2,
          },
          trade,
          trade_id: trade.id,
          ...(isHighlighted
            ? {
                label: {
                  show: true,
                  formatter: trade.exit_reason || "Exit",
                  position: "bottom",
                  color: "#FFD700",
                  fontWeight: "bold",
                  fontSize: 11,
                },
              }
            : {}),
        };

        if (isSameCandle) {
          const entryMarker = entryMarkers.find((m) => m.trade_id === trade.id);
          if (entryMarker) entryMarker.symbolOffset = [0, -20];
        }

        const bucket = matchedConfig ? matchedConfig.name : "Force";
        const arr = exitMarkersByConfig.get(bucket);
        if (arr) arr.push(exitMarker);
        else {
          exitMarkersByConfig.set(bucket, [exitMarker]);
        }
      }
    }
  }

  const series: any[] = [];

  if (entryMarkers.length > 0) {
    series.push({ name: "Entry", type: "scatter", data: entryMarkers, symbolSize: 18, z: 10 });
  }

  for (const [name, markers] of exitMarkersByConfig) {
    if (markers.length > 0) {
      series.push({ name, type: "scatter", data: markers, symbolSize: 14, z: 10 });
    }
  }

  return series;
}
