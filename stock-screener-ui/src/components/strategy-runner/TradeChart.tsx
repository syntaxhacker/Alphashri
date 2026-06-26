import { useEffect, useRef } from "react";
import { Box } from "@mantine/core";

const API_BASE = "";

interface TradeChartProps {
  symbol: string;
  date: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  stopLoss?: number;
  takeProfit?: number;
  height?: number;
}

export function TradeChart({ symbol, date, entryPrice, exitPrice, entryTime, exitTime, stopLoss, takeProfit, height = 300 }: TradeChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const echartsLib = (window as any).echarts;
    if (!echartsLib) return;
    instanceRef.current = echartsLib.init(chartRef.current);
    return () => { instanceRef.current?.dispose(); };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;

    fetch(`${API_BASE}/api/chart/preview?symbol=${symbol}&date=${date}`)
      .then(r => r.json())
      .then(data => {
        const candles = data?.candles || [];
        if (!candles.length || !chart) return;

        const times = candles.map((c: any) => c.time?.slice(11, 16) || "");
        const ohlc = candles.map((c: any) => [c.open, c.close, c.low, c.high]);
        const closes = candles.map((c: any) => c.close);

        const entryIdx = candles.findIndex((c: any) => c.time >= entryTime);
        const exitIdx = candles.findIndex((c: any) => c.time >= exitTime);

        const option = {
          tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
          grid: { left: 50, right: 20, top: 40, bottom: 30 },
          xAxis: { data: times, axisLabel: { rotate: 45, fontSize: 9 }, show: entryIdx >= 0 },
          yAxis: { scale: true, min: (value: any) => Math.min(value.min * 0.995, entryPrice * 0.99),
                   max: (value: any) => Math.max(value.max * 1.005, exitPrice * 1.01) },
          series: [{
            type: "candlestick",
            data: ohlc,
            itemStyle: { color: "#26a69a", color0: "#ef5350", borderColor: "#26a69a", borderColor0: "#ef5350" },
            markLine: {
              silent: true,
              data: [
                { yAxis: entryPrice, label: { formatter: "Entry " + entryPrice, position: "insideEndTop" }, lineStyle: { color: "#4caf50", type: "dashed" } },
                { yAxis: exitPrice, label: { formatter: "Exit " + exitPrice, position: "insideEndBottom" }, lineStyle: { color: entryPrice <= exitPrice ? "#4caf50" : "#f44336", type: "solid" } },
                ...(stopLoss > 0 ? [{ yAxis: stopLoss, label: { formatter: "SL " + stopLoss, position: "insideEndTop" }, lineStyle: { color: "#f44336", type: "dotted" } }] : []),
                ...(takeProfit > 0 ? [{ yAxis: takeProfit, label: { formatter: "TP " + takeProfit, position: "insideEndBottom" }, lineStyle: { color: "#4caf50", type: "dotted" } }] : []),
              ],
            },
          }],
        };

        chart.setOption(option, true);
        chart.dispatchAction({ type: "dataZoom", startValue: Math.max(0, (entryIdx || 0) - 30), endValue: Math.min(times.length - 1, (exitIdx || times.length - 1) + 30) });
      })
      .catch(() => {});

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [symbol, date, entryPrice, exitPrice, entryTime, exitTime, stopLoss, takeProfit]);

  return (
    <Box style={{ width: "100%", height, minHeight: height }}>
      <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
    </Box>
  );
}
