import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { TradeHistoryTable } from "@/components/backtest/TradeHistoryTable";
import { MOCK_BACKTEST_RESULTS } from "@/stories/fixtures";
import type { Trade } from "@/types/backtest";

function toTrades(): Trade[] {
  return MOCK_BACKTEST_RESULTS.flatMap((r, ri) =>
    Array.from({ length: r.trades }, (_, i) => ({
      entry_price: 1400 + i * 10, exit_price: 1410 + i * 5, entry_time: `2026-03-2${ri + 1}T09:30:00`, exit_time: `2026-03-2${ri + 1}T15:15:00`,
      quantity: 10, gross_pnl: i % 2 === 0 ? 120 : -60, gross_pnl_pct: i % 2 === 0 ? 0.8 : -0.4, trading_costs: 10, net_pnl: i % 2 === 0 ? 110 : -70, net_pnl_pct: i % 2 === 0 ? 0.7 : -0.5,
      exit_reason: (i % 3 === 0 ? "TP" : i % 3 === 1 ? "SL" : "EOD") as Trade["exit_reason"], hold_duration_minutes: 120, date: `2026-03-2${ri + 1}`,
      or_high: 1422, or_low: 1410, symbol: r.symbol,
    } as Trade))
  );
}
const mockTrades = toTrades();

const meta: Meta<typeof TradeHistoryTable> = {
  title: "Patterns/Tables/TradeHistory",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof TradeHistoryTable>;

export const Default: Story = {
  render: () => <Box p="sm"><TradeHistoryTable symbol="RELIANCE" trades={mockTrades} sortColumn="entry_time" sortDirection="desc" onSort={() => {}} onRowClick={() => {}} onClose={() => {}} /></Box>,
};
export const Empty: Story = {
  render: () => <Box p="sm"><TradeHistoryTable symbol="RELIANCE" trades={[]} sortColumn="entry_time" sortDirection="desc" onSort={() => {}} onRowClick={() => {}} onClose={() => {}} /></Box>,
};
