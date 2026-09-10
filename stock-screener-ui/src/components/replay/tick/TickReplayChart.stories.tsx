import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import TickReplayChart from "./TickReplayChart";
import { genMockBars, mockIfvgLong } from "./mockBars";
import type { ReplayTrade } from "./types";

const bars = genMockBars(260, 7);
const { trade: shortTp } = mockIfvgLong();
const t0 = mockIfvgLong().bars[0].time;

const longSl: ReplayTrade = {
  time: t0 + 60, exit_time: t0 + 300, side: "LONG", kind: "retest",
  entry: 101, sl: 99, tp: 105, exit: 99, result: "SL", pnl: -2, rr: -1,
};
const breakeven: ReplayTrade = {
  time: t0 + 60, exit_time: t0 + 240, side: "LONG", kind: "inv",
  entry: 101, sl: 101, tp: 105, exit: 100.9, result: "SL", pnl: -0.1, rr: -0.05,
};
const trail: ReplayTrade = {
  time: t0 + 60, exit_time: t0 + 300, side: "SHORT", kind: "inv",
  entry: 102, sl: 104, tp: null, exit: 100.5, result: "TRAIL", pnl: 1.5, rr: 0.75,
};

const meta: Meta<typeof TickReplayChart> = {
  title: "Replay/Tick/TickReplayChart",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Composed tick-replay chart: NT dark candles + entry/exit markers, SL/TP lines, zone/trend overlay and the TV-style R:R box. One component serves every future strategy — pages pass bars + trade + zones.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof TickReplayChart>;

const wrap = (s: Story["render"]) => s;

export const MockOnly: Story = {
  render: wrap(() => <Box><TickReplayChart height={520} bars={bars} /></Box>),
};
export const WithZones: Story = {
  render: wrap(() => (
    <Box>
      <TickReplayChart
        height={520}
        bars={bars}
        zones={[
          { kind: "supply", t1: bars[20].time, t2: bars[60].time, top: 101.5, bottom: 100.5, label: "SUPPLY" },
          { kind: "ifvg", t1: bars[100].time, t2: bars[140].time, top: 101, bottom: 100.2, label: "1m iFVG" },
        ]}
        trends={[{ t1: bars[10].time, p1: 99.5, t2: bars[65].time, p2: 101, label: "LRL" }]}
      />
    </Box>
  )),
};
export const ShortTp: Story = {
  render: wrap(() => <Box><TickReplayChart height={520} bars={mockIfvgLong().bars} trade={shortTp} /></Box>),
};
export const LongSl: Story = {
  render: wrap(() => <Box><TickReplayChart height={520} bars={mockIfvgLong().bars} trade={longSl} /></Box>),
};
export const Breakeven: Story = {
  render: wrap(() => <Box><TickReplayChart height={520} bars={mockIfvgLong().bars} trade={breakeven} /></Box>),
};
export const TrailNoTp: Story = {
  render: wrap(() => <Box><TickReplayChart height={520} bars={mockIfvgLong().bars} trade={trail} /></Box>),
};
