import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text, Stack, Card, Title, Divider, Group } from "@/ui";
import { ChartHeader } from "@/pages/chart/ChartHeader";
import { ChartBody } from "@/pages/chart/ChartBody";
import { ChartError } from "@/pages/chart/ChartError";
import { ArticleDetail } from "@/components/news/ArticleDetail";
import { BotStatusPanel } from "@/components/bots/BotStatusPanel2";
import { MOCK_PAPER_POSITIONS, MOCK_PAPER_TRADES, MOCK_SECTOR_STOCKS, MOCK_SPOT_RELIANCE } from "../fixtures";

function DetailChrome({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box h={520} style={{ display: "flex", flexDirection: "column", border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}>
      <Group justify="space-between" px="md" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <div><Text fw={600} size="sm">{title}</Text>{subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}</div>
      </Group>
      <Box flex={1} p="sm" style={{ overflow: "auto" }}>{children}</Box>
      <Divider /><Group px="md" py="xs" gap="xs"><Text size="xs" c="dimmed">Footer — derived stats · related links</Text></Group>
    </Box>
  );
}

const mockArticle = {
  id: "a1", headline: `RELIANCE hits ₹${MOCK_SPOT_RELIANCE} — Q4 earnings beat; ${MOCK_SECTOR_STOCKS[0].symbol} leads Energy`,
  description: "Reliance Industries reported a 12% YoY rise in consolidated profit, driven by retail and Jio. Analysts raised target to ₹1650.",
  source: "Moneycontrol", sourceUrl: "https://example.com/reliance-q4", publishedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(),
  symbols: [{ name: "RELIANCE", code: "RELIANCE", url: "", trading_symbol: "RELIANCE", instrument_key: "NSE_EQ|INE002A01018" }],
} as any;

const mockArticleContent = {
  ...mockArticle, sentiment: "BULLISH" as const, impact_score: 8, summary: "Bullish: earnings beat, retail growth 18%. Risk: refining margins soft.",
  key_points: ["Net profit +12% YoY", "Retail revenue +18%", "Jio ARPU ₹195"], key_entities: ["RELIANCE", "Jio"],
  trade_ideas: [{ symbol: "RELIANCE", direction: "LONG" as const, reasoning: "Breakout above ₹1420 with volume" }],
  analysis_status: "done" as const, symbols: mockArticle.symbols,
} as any;

const mockBotStatus = {
  bot_id: "bot-1", running: true, pid: 1234, status: "running" as const,
  portfolio: { initial_capital: 100000, cash: 42000, margin_used: 30100, total_value: 102340, total_pnl: 2340, total_pnl_pct: 2.34, daily_pnl: 420, total_positions: 2 },
  strategies: {
    s1: { strategy_id: "s1", strategy_name: "ORB Best", status: "running" as const, active_positions: 1, positions_count: 1, max_positions: 3, allocated_capital: 50000, capital_used: 14100, capital_used_pct: 28, total_pnl: 180, trades_count: 6, portfolio_status: null },
  },
  positions: MOCK_PAPER_POSITIONS.slice(0, 2).map((p: any) => ({ strategy_id: String(p.strategy_id), strategy_name: p.strategy_name, symbol: p.symbol, side: p.side, quantity: p.quantity, entry_price: p.entry_price, current_price: p.current_price, unrealized_pnl: p.pnl, unrealized_pnl_pct: p.pnl_pct, stop_loss: p.stop_loss, take_profit: p.take_profit, entry_time: p.entry_time })),
  last_update: new Date().toISOString(),
} as any;

const mockBotTrades = MOCK_PAPER_TRADES.slice(0, 2).map((t: any) => ({ id: t.trade_id, symbol: t.symbol, side: t.side, quantity: t.quantity, entry_price: t.entry_price, exit_price: t.exit_price, pnl: t.pnl, pnl_pct: t.pnl_pct, net_pnl: t.net_pnl, realized_pnl: t.pnl, strategy_id: String(t.strategy_id), strategy_name: t.strategy_name, entry_time: t.entry_time, exit_time: t.exit_time, exit_reason: t.exit_reason, is_test: false, is_test_data: false }));

const meta: Meta = {
  title: "Templates/Asset Detail",
  tags: ["autodocs"],
  parameters: { layout: "padded", docs: { description: { component: "Detail View — Header → Body → Footer. NewsDetail uses `MOCK_SECTOR_STOCKS`/`MOCK_SPOT_RELIANCE`; BotDetail uses `MOCK_PAPER_POSITIONS`/`MOCK_PAPER_TRADES` from `fixtures.ts`." } } },
};
export default meta;

export const Anatomy: StoryObj = {
  render: () => (
    <DetailChrome title="RELIANCE — Detail anatomy" subtitle="Header · Body · Footer">
      <Stack gap="sm"><Card withBorder p="sm"><Title order={6}>Body</Title><Text size="xs" c="dimmed">Chart, article, or bot — same shell.</Text></Card></Stack>
    </DetailChrome>
  ),
};
export const ChartDetail: StoryObj = {
  render: () => (
    <Box p="sm" h={520} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ChartHeader symbol="RELIANCE" timeframe={15} orMinutes={45} showPivots={false} show52wHigh={false} onBack={() => {}} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />
      <ChartBody loading={false} error={null} chartError={null} hasData={false} />
    </Box>
  ),
};
export const NewsDetail: StoryObj = {
  render: () => <Box maw={720} mx="auto"><ArticleDetail selectedArticle={mockArticle} articleContent={mockArticleContent} articleLoading={false} isMobile={false} showFullContent={false} onClose={() => {}} onToggleFullContent={() => {}} onSymbolClick={() => {}} /></Box>,
};
export const BotDetail: StoryObj = {
  render: () => <BotStatusPanel bot={{ id: "bot-1", uuid: "bot-1", name: "Demo Bot", is_active: true, max_total_positions: 5, max_total_capital_pct: 0.8, max_daily_loss_pct: 0.03, live_trading: false, strategies: [], created_at: null, updated_at: null, running: true, pid: 1234 } as any} status={mockBotStatus} trades={mockBotTrades as any} onStart={async () => {}} onStop={async () => {}} />,
};
export const Empty: StoryObj = { render: () => <Box p="sm"><ChartError onBackToScreener={() => {}} /></Box> };
export const Loading: StoryObj = {
  render: () => (
    <Box p="sm" h={420} style={{ display: "flex", flexDirection: "column" }}>
      <ChartHeader symbol="RELIANCE" timeframe={15} orMinutes={45} showPivots={false} show52wHigh={false} onBack={() => {}} onTimeframeChange={() => {}} onOrMinutesChange={() => {}} onPivotsChange={() => {}} on52wHighChange={() => {}} />
      <ChartBody loading error={null} chartError={null} hasData={false} />
    </Box>
  ),
};
