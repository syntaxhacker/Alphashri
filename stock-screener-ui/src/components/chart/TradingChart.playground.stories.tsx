import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Box, Group, Switch } from "@/ui";
import { TradingChart } from "./TradingChart";
import { MOCK_CANDLES, MOCK_PAPER_ORB, MOCK_PAPER_PIVOT, MOCK_PAPER_52W, MOCK_PAPER_EMA } from "@/stories/fixtures";

const meta: Meta<typeof TradingChart> = {
  title: "Composites/Charts/TradingChart",
  component: TradingChart,
  tags: ["autodocs"],
  parameters: { layout: "padded", docs: { description: { component: "TradingChart playground — the single ECharts wrapper. Toggle overlays live via Controls; the 5 decoupled stories in Templates/Chart + Patterns/Charts/BacktestChart exist for Chromatic (one line family per snapshot)." } } },
};
export default meta;
type Story = StoryObj<typeof TradingChart>;

function Playground({ chartKey }: { chartKey: string }) {
  const [showOrb, setShowOrb] = useState(chartKey === "orb");
  const [showPivots, setShowPivots] = useState(chartKey === "pivot");
  const [show52w, setShow52w] = useState(chartKey === "52w");
  const [showEma, setShowEma] = useState(chartKey === "ema");
  const map: Record<string, any> = { orb: MOCK_PAPER_ORB, pivot: MOCK_PAPER_PIVOT, "52w": MOCK_PAPER_52W, ema: MOCK_PAPER_EMA, all: { ...MOCK_PAPER_ORB, pivot_levels: (MOCK_PAPER_PIVOT as any).pivot_levels, week52_levels: (MOCK_PAPER_52W as any).week52_levels, ema_series: (MOCK_PAPER_EMA as any).ema_series } };
  const base = map[chartKey] || map.all;
  const input: any = { candles: MOCK_CANDLES, trades: [], overlays: [...(showOrb && base.orb_levels ? [{ id: "orb", type: "box", levels: [base.orb_levels] }] : []), ...(showPivots && base.pivot_levels ? [{ id: "pivot", type: "line", levels: [base.pivot_levels] }] : []), ...(show52w && base.week52_levels ? [{ id: "52w", type: "line", levels: [base.week52_levels] }] : [])], emaData: showEma ? [base.ema_series?.ema_fast, base.ema_series?.ema_slow].filter(Boolean) : undefined };
  return (<Box><Group gap="sm" mb="xs"><Switch size="xs" label="ORB" checked={showOrb} onChange={(e) => setShowOrb(e.currentTarget.checked)} /><Switch size="xs" label="Pivots" checked={showPivots} onChange={(e) => setShowPivots(e.currentTarget.checked)} /><Switch size="xs" label="52W" checked={show52w} onChange={(e) => setShow52w(e.currentTarget.checked)} /><Switch size="xs" label="EMA 9/21" checked={showEma} onChange={(e) => setShowEma(e.currentTarget.checked)} /></Group><Box h={380}><TradingChart input={input} /></Box></Box>);
}
export const PlaygroundAll: Story = { name: "Playground — toggle any combination", render: () => <Playground chartKey="all" /> };
