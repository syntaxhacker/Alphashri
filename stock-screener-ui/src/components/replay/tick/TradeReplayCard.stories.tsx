import type { Meta, StoryObj } from "@storybook/react-vite";
import TradeReplayCard from "./TradeReplayCard";
import { mockIfvgLong } from "./mockBars";
import type { ReplayTrade } from "./types";

const { bars, trade: tp } = mockIfvgLong();
const t0 = bars[0].time;
const at = (min: number) => t0 + min * 60;

const sl: ReplayTrade = {
  ...tp, side: "LONG", kind: "retest", time: at(1), exit_time: at(5),
  entry: 101, sl: 99, tp: 105, exit: 99, result: "SL", pnl: -2, rr: -1,
};
const be: ReplayTrade = {
  ...tp, side: "LONG", time: at(1), exit_time: at(4),
  entry: 101, sl: 101, tp: 105, exit: 100.9, result: "SL", pnl: -0.1, rr: -0.05,
};
const trail: ReplayTrade = {
  ...tp, time: at(1), exit_time: at(5),
  entry: 102, sl: 104, tp: null, exit: 100.5, result: "TRAIL", pnl: 1.5, rr: 0.75,
};

const timeLabel = (ts: number) =>
  new Date(ts * 1000).toISOString().slice(11, 16);
const explainer = (t: ReplayTrade) =>
  t.kind === "inv"
    ? "1m close through FVG opposite edge, BOS-aligned. Entry next tick, SL beyond nearest opposing structure."
    : "Pullback into active FVG zone (touch within 2pts). SL beyond zone edge.";

const meta: Meta<typeof TradeReplayCard> = {
  title: "Replay/Tick/TradeReplayCard",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Per-trade replay unit: header chips (side/stack/kind/result), stats, explainer and chart. TP/SL/BE/TRAIL — the four outcomes backtests produce.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof TradeReplayCard>;

export const TakeProfit: Story = {
  render: () => <TradeReplayCard bars={bars} trade={{ ...tp, stack: "inv" }} index={0} timeLabel={timeLabel} explainer={explainer} chartHeight={520} />,
};
export const StopLoss: Story = {
  render: () => <TradeReplayCard bars={bars} trade={{ ...sl, stack: "retest" }} index={1} timeLabel={timeLabel} explainer={explainer} chartHeight={520} />,
};
export const Breakeven: Story = {
  render: () => <TradeReplayCard bars={bars} trade={{ ...be, stack: "inv" }} index={2} timeLabel={timeLabel} explainer={explainer} chartHeight={520} />,
};
export const Trail: Story = {
  render: () => <TradeReplayCard bars={bars} trade={{ ...trail, stack: "inv" }} index={3} timeLabel={timeLabel} explainer={explainer} chartHeight={520} />,
};
