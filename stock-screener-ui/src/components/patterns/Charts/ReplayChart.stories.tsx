import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { ReplayChart } from "@/components/replay/ReplayChart";
import { MOCK_CANDLES } from "@/stories/fixtures";

const mockCandles = MOCK_CANDLES.map(c => ({ time: `${c.date} ${c.time_str}`, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
const defaultProps = {
  candlesBySymbol: { RELIANCE: mockCandles as any }, trades: [], orLevels: [], pivotLevels: [], high52wLevels: [], emaData: {},
  selectedSymbol: "RELIANCE", setSelectedSymbol: () => {}, chartOptions: { show_all_trades: true, show_orb_zones: true, show_pivot_levels: true, show_52w_high: false, show_ema: false } as any,
  setChartOptions: () => {}, highlightedTradeId: null as number | null,
};

const meta: Meta<typeof ReplayChart> = {
  title: "Patterns/Charts/ReplayChart",
  tags: ["autodocs"],
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ReplayChart pattern — intraday replay candlestick chart with date/symbol switching and overlay toggles (ORB, pivots, 52W high, EMA). Use for forward-testing/replay sessions via `candlesBySymbol` + `chartOptions`. When not: for historical backtest overlays use BacktestChart.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ReplayChart>;

export const Default: Story = { render: () => <Box h={400} p="sm"><ReplayChart {...defaultProps} /></Box> };
export const Empty: Story = { render: () => <Box h={400} p="sm"><ReplayChart {...defaultProps} candlesBySymbol={{}} /></Box> };
