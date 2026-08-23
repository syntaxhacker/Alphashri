import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { BacktestChart } from "@/components/backtest/BacktestChart";
import {
  MOCK_CANDLES,
  MOCK_CHART_DATA,
  MOCK_ORB_CHART,
  MOCK_PIVOT_CHART,
  MOCK_52W_CHART,
} from "@/stories/fixtures";
import type { SymbolChartData } from "@/types/backtest";

function mkTrades(exitReason: string, entryIdx = 5, exitIdx = 20) {
  return [
    { trade_id: 1, type: "entry", time: MOCK_CANDLES[entryIdx].time, date: MOCK_CANDLES[entryIdx].date, price: MOCK_CANDLES[entryIdx].close, marker: { symbol: "triangleUp", color: "#22c55e", size: 14 }, trade: { entry_price: 1410, exit_price: 1425, quantity: 10, gross_pnl: 150, trading_costs: 10, net_pnl: 140, net_pnl_pct: 0.99, exit_reason: exitReason, hold_duration_minutes: 120 } },
    { trade_id: 1, type: "exit", time: MOCK_CANDLES[exitIdx].time, date: MOCK_CANDLES[exitIdx].date, price: MOCK_CANDLES[exitIdx].close, marker: { symbol: "triangleDown", color: "#ef4444", size: 14 }, trade: { entry_price: 1410, exit_price: 1425, quantity: 10, gross_pnl: 150, trading_costs: 10, net_pnl: 140, net_pnl_pct: 0.99, exit_reason: exitReason, hold_duration_minutes: 120 } },
  ] as any;
}

function baseData(overrides: Partial<SymbolChartData>): SymbolChartData {
  return {
    symbol: "RELIANCE",
    candles: MOCK_CANDLES as any,
    orb_zones: [],
    pivot_levels: [],
    week52_levels: [],
    trades: mkTrades("TP"),
    date_range: { start: MOCK_CANDLES[0].date, end: MOCK_CANDLES.at(-1)!.date },
    total_candles: MOCK_CANDLES.length,
    total_trades: 1,
    ...overrides,
  } as any;
}

const orbData = baseData({ orb_zones: (MOCK_ORB_CHART as any).orb_zones });
const pivotData = baseData({ pivot_levels: (MOCK_PIVOT_CHART as any).pivot_levels });
const high52wData = baseData({ week52_levels: [{ date: "2026-03-20", date_raw: "2026-03-20", "52w_high": 1605.5 }] as any });
const bareData = baseData({});

const meta: Meta<typeof BacktestChart> = {
  title: "Patterns/Charts/BacktestChart",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof BacktestChart>;

export const OrbOnly: Story = { name: "ORB — blue box", render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={orbData} holidays={[]} onTradeClick={() => {}} /></Box> };
export const PivotsOnly: Story = { name: "S/R Pivots — PP/R1/S1", render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={pivotData} holidays={[]} onTradeClick={() => {}} /></Box> };
export const High52wOnly: Story = { name: "52W High — pink dashed (CHASER/TARGET)", render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={high52wData} holidays={[]} onTradeClick={() => {}} /></Box> };
export const EmaOnly: Story = {
  name: "EMA 9/21 — ADX/VOLUME no-overlay companion",
  render: () => {
    const emaData = baseData({
      // visuals.ema_series is the Backtest EMA payload (checked in normalizeBacktest)
      visuals: { overlays: [], ema_series: [{ label: "EMA 9", color: "#22c55e", data: Array(50).fill(null).map((_, i) => (i < 8 ? null : 1410 + Math.sin(i / 3) * 8)) }, { label: "EMA 21", color: "#a855f7", data: Array(50).fill(null).map((_, i) => (i < 20 ? null : 1410 + Math.cos(i / 4) * 6)) }] } as any,
    });
    return <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={emaData} holidays={[]} onTradeClick={() => {}} /></Box>;
  },
};
export const BareCandles: Story = { name: "Bare — ADX / Volume Surge", render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={bareData} holidays={[]} onTradeClick={() => {}} /></Box> };
export const Default: Story = {
  name: "Default — all overlays bundled",
  render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={{ ...orbData, pivot_levels: (MOCK_PIVOT_CHART as any).pivot_levels, week52_levels: (high52wData as any).week52_levels } as any} holidays={[]} onTradeClick={() => {}} /></Box>,
};
export const Empty: Story = { render: () => <Box h={400} p="sm"><BacktestChart symbol="RELIANCE" chartData={null} holidays={[]} /></Box> };
