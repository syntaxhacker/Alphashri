import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Box } from "@/ui";
import { AggregatedDashboard } from "@/components/paper-trading/AggregatedDashboard";
import { SectorPage } from "@/components/sector/SectorPage2";
import AdminPage from "@/pages/AdminPage";
import { MOCK_PAPER_TRADES, MOCK_PAPER_POSITIONS, MOCK_SECTOR_STOCKS } from "../fixtures";

function mockAnalytics(empty = false): any {
  if (empty) return { period: { preset: "30D", from_date: null, to_date: new Date().toISOString().slice(0, 10), bot_id: "all", trade_count: 0 }, summary: { total_trades: 0, winners: 0, losers: 0, win_rate: 0, total_gross_pnl: 0, total_net_pnl: 0, total_costs: 0, avg_win: 0, avg_loss: 0, profit_factor: null, avg_hold_minutes: 0, max_drawdown: 0, max_drawdown_pct: 0, best_day: null, worst_day: null }, bot_rankings: [], strategy_rankings: [], daily_pnl: [], equity_curve: [], drawdown: [], biggest_winners: [], biggest_losers: [], symbol_performance: [], exit_reasons: [] };
  const t = MOCK_PAPER_TRADES as any[]; void MOCK_PAPER_POSITIONS.length;
  const winners = t.filter((x) => x.pnl > 0);
  return {
    period: { preset: "30D", from_date: "2026-03-01", to_date: "2026-03-20", bot_id: "all", trade_count: t.length },
    summary: { total_trades: t.length, winners: winners.length, losers: t.length - winners.length, win_rate: (winners.length / t.length) * 100, total_gross_pnl: t.reduce((a, x) => a + x.pnl, 0), total_net_pnl: t.reduce((a, x) => a + x.net_pnl, 0), total_costs: t.reduce((a, x) => a + x.costs, 0), avg_win: 200, avg_loss: -120, profit_factor: 1.6, avg_hold_minutes: 300, max_drawdown: 130, max_drawdown_pct: 1.2, best_day: { date: "2026-03-19", net_pnl: 188, trades: 1, winners: 1, losers: 0 }, worst_day: { date: "2026-03-18", net_pnl: -130, trades: 1, winners: 0, losers: 1 } },
    bot_rankings: [{ bot_id: "bot-1", bot_name: "ORB Best — Paper", running: true, total_net_pnl: 58, total_trades: t.length, win_rate: 50, profit_factor: 1.6, max_drawdown: 130, max_drawdown_pct: 1.2, avg_hold_minutes: 300 }],
    strategy_rankings: [{ bot_id: "bot-1", bot_name: "ORB Best — Paper", strategy_id: 1, strategy_name: "ORB Best", total_net_pnl: 58, total_trades: t.length, win_rate: 50, profit_factor: 1.6, avg_hold_minutes: 300 }],
    daily_pnl: [{ date: "2026-03-19", net_pnl: 188, trades: 1, winners: 1, losers: 0 }, { date: "2026-03-18", net_pnl: -130, trades: 1, winners: 0, losers: 1 }],
    equity_curve: [{ date: "2026-03-18", cumulative_pnl: -130 }, { date: "2026-03-19", cumulative_pnl: 58 }],
    drawdown: [{ date: "2026-03-18", drawdown: 130, drawdown_pct: 1.2 }, { date: "2026-03-19", drawdown: 0, drawdown_pct: 0 }],
    biggest_winners: t.slice(0, 1).map((x: any) => ({ trade_id: x.trade_id, symbol: x.symbol, bot_id: "bot-1", bot_name: "ORB Best — Paper", strategy_id: x.strategy_id, strategy_name: x.strategy_name, side: x.side, entry_time: x.entry_time, exit_time: x.exit_time, net_pnl: x.net_pnl, pnl_pct: x.pnl_pct, exit_reason: x.exit_reason, hold_duration_minutes: x.hold_duration_minutes })),
    biggest_losers: t.slice(1, 2).map((x: any) => ({ trade_id: x.trade_id, symbol: x.symbol, bot_id: "bot-1", bot_name: "ORB Best — Paper", strategy_id: x.strategy_id, strategy_name: x.strategy_name, side: x.side, entry_time: x.entry_time, exit_time: x.exit_time, net_pnl: x.net_pnl, pnl_pct: x.pnl_pct, exit_reason: x.exit_reason, hold_duration_minutes: x.hold_duration_minutes })),
    symbol_performance: [{ symbol: "RELIANCE", total_net_pnl: 188, total_trades: 1, win_rate: 100 }, { symbol: "INFY", total_net_pnl: -130, total_trades: 1, win_rate: 0 }],
    exit_reasons: [{ reason: "TP", count: 1, pct: 50 }, { reason: "SL", count: 1, pct: 50 }],
  };
}
function mockSector(empty = false): any {
  if (empty) return { sectors: [], top_stock_movers: [], last_updated: new Date().toISOString(), market: "india" };
  const names = ["Energy", "IT", "Bank", "FMCG", "Pharma", "Auto", "Metal", "Realty", "Media", "Infra"];
  return { sectors: names.map((s, i) => ({ sector: s, avg_change: +(Math.random() * 4 - 1).toFixed(2), stock_count: 12, advances: 7 + (i % 3), declines: 5 - (i % 2), avg_rsi: 55, avg_adx: 22, top_movers: MOCK_SECTOR_STOCKS.slice(i, i + 2).map((x: any) => x.symbol).join(", ") })), top_stock_movers: MOCK_SECTOR_STOCKS.slice(0, 5).map((x: any) => ({ symbol: x.symbol, change: x.change_pct })), last_updated: new Date().toISOString(), market: "india" };
}
function mockLlm(empty = false): any {
  if (empty) return { aggregate: { total_runs: 0, total_tokens: 0, total_cost_usd: 0, avg_response_time_ms: 0, models_used: [] }, recent_runs: [] };
  return { aggregate: { total_runs: 42, total_tokens: 128000, total_cost_usd: 1.23, avg_response_time_ms: 850, models_used: [{ model: "openai/gpt-oss-20b:free", count: 42 }] }, recent_runs: [{ id: 1, url: "https://example.com/article", model: "openai/gpt-oss-20b:free", input_tokens: 1200, output_tokens: 800, cost_usd: 0.02, response_time_ms: 820, status: "success", created_at: new Date().toISOString() }] };
}
function withFetch(mock: (url: string) => any) {
  return (Story: any) => {
    useEffect(() => {
      const orig = window.fetch;
      // @ts-ignore
      window.fetch = async (url: string, opts?: any) => {
        const m = mock(String(url));
        if (m !== undefined) return { ok: true, status: 200, json: async () => m, text: async () => JSON.stringify(m) } as Response;
        return orig(url as any, opts);
      };
      return () => { window.fetch = orig; };
    }, []);
    return <Story />;
  };
}
const paperMock = (u: string) => (u.includes("/api/paper/dashboard/analytics") ? mockAnalytics(false) : undefined);
const paperEmptyMock = (u: string) => (u.includes("/api/paper/dashboard/analytics") ? mockAnalytics(true) : undefined);
const sectorMock = (u: string) => (u.includes("/api/sector") ? mockSector(false) : u.includes("/api/heatmap") ? { stocks: MOCK_SECTOR_STOCKS.slice(0, 8).map((s: any) => ({ symbol: s.symbol, sector: s.sector, change_pct: s.change_pct })) } : undefined);
const sectorEmptyMock = (u: string) => (u.includes("/api/sector") ? mockSector(true) : undefined);
const adminMock = (u: string) => (u.includes("/api/admin/llm") ? mockLlm(false) : u.includes("/api/admin/52w") ? { job: { status: "completed", total: 10, processed: 10, ok: 10, progress_pct: 100 }, database: { db_row_count: 10, db_latest_updated_at: new Date().toISOString(), expected_universe: 10, coverage_pct: 100 }, fetched_at: new Date().toISOString() } : u.includes("/api/admin/news-queue") ? { queue: { pending: 2, processing: 1, done: 40, failed: 0, total: 43 }, needs_analysis: { broken_summary: 0, null_analysis: 2 }, recent_failures: [] } : undefined);
const adminEmptyMock = (u: string) => (u.includes("/api/admin/llm") ? mockLlm(true) : undefined);

const meta: Meta = {
  title: "Templates/Trading Desk",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Trading Desk — aggregated dashboards for paper P&L, sector breadth, and admin ops. Use to overview performance across bots/sectors at a glance. When not: for single-bot control use Bots at /bots or for trade drill-down use Paper Trading at /paper.",
      },
    },
  },
};
export default meta;
export const PaperDefault: StoryObj = { name: "Paper — Default (populated)", decorators: [withFetch(paperMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><AggregatedDashboard /></Box> };
export const PaperEmpty: StoryObj = { name: "Paper — Empty", decorators: [withFetch(paperEmptyMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><AggregatedDashboard /></Box> };
export const SectorDefault: StoryObj = { name: "Sector — Default (10 sectors)", decorators: [withFetch(sectorMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><SectorPage /></Box> };
export const SectorEmpty: StoryObj = { name: "Sector — Empty", decorators: [withFetch(sectorEmptyMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><SectorPage /></Box> };
export const AdminDefault: StoryObj = { name: "Admin — Default", decorators: [withFetch(adminMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><AdminPage /></Box> };
export const AdminEmpty: StoryObj = { name: "Admin — Empty", decorators: [withFetch(adminEmptyMock)], render: () => <Box p="xs" h="100vh" style={{ overflow: "auto" }}><AdminPage /></Box> };
