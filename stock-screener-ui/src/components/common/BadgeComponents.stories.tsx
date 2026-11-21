import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { ExitReasonBadge, SideBadge, StatusBadge, TradingModeBadge } from "./BadgeComponents";
import { PnlText } from "./PnlText";

const meta: Meta = { title: "Terminal/Badges & figures", tags: ["autodocs"] };
export default meta;

type Story = StoryObj;

export const Badges: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
        <SideBadge side="BUY" />
        <SideBadge side="SELL" />
        <ExitReasonBadge reason="TP" />
        <ExitReasonBadge reason="SL" />
        <ExitReasonBadge reason="TRAILING_STOP" />
        <StatusBadge running />
        <StatusBadge running={false} statusUnknown />
        <TradingModeBadge liveTrading />
        <TradingModeBadge liveTrading={false} />
      </div>
    )),
};

export const Pnl: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "flex", gap: "16px", "font-size": "13px" }}>
        <PnlText value={1240.5} />
        <PnlText value={-318.25} />
        <PnlText value={0} />
      </div>
    )),
};
