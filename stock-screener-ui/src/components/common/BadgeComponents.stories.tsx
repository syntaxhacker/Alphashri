import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Group, Title } from "@/ui";
import { SideBadge, ExitReasonBadge, TradingModeBadge, StatusBadge } from "./BadgeComponents";

const meta: Meta<typeof SideBadge> = {
  title: "Composites/Badges",
  component: SideBadge,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          'Status badges for trading UI — `SideBadge` (BUY/SELL/LONG/SHORT), `ExitReasonBadge` (TP/SL/trailing/EOD), `TradingModeBadge` (live vs paper), and `StatusBadge` (bot running/stopped). Use inside tables, position rows, or headers where a compact color-coded state is needed. When not: for P&L values use `PnlText`/`PnlBadge` instead.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SideBadge>;

export const AllBadges: Story = {
  render: () => (
    <Stack gap="md">
      <div>
        <Title order={5}>SideBadge</Title>
        <Group gap="xs" mt="xs">
          <SideBadge side="BUY" />
          <SideBadge side="SELL" />
          <SideBadge side="LONG" />
          <SideBadge side="SHORT" />
        </Group>
      </div>
      <div>
        <Title order={5}>ExitReasonBadge</Title>
        <Group gap="xs" mt="xs">
          <ExitReasonBadge reason="TP" />
          <ExitReasonBadge reason="SL" />
          <ExitReasonBadge reason="TRAILING_STOP" />
          <ExitReasonBadge reason="EOD" />
          <ExitReasonBadge reason="MANUAL_CLOSE" />
        </Group>
      </div>
      <div>
        <Title order={5}>TradingModeBadge</Title>
        <Group gap="xs" mt="xs">
          <TradingModeBadge liveTrading={false} />
          <TradingModeBadge liveTrading={true} />
        </Group>
      </div>
      <div>
        <Title order={5}>StatusBadge</Title>
        <Group gap="xs" mt="xs">
          <StatusBadge running={true} pid={12345} />
          <StatusBadge running={false} />
          <StatusBadge running={false} statusUnknown={true} />
        </Group>
      </div>
    </Stack>
  ),
};

export const SideBuy: Story = {
  args: { side: "BUY" },
};

export const SideSell: Story = {
  args: { side: "SELL" },
};

export const ExitTP: Story = {
  render: () => <ExitReasonBadge reason="TP" />,
};

export const ExitSL: Story = {
  render: () => <ExitReasonBadge reason="SL" />,
};

export const ExitTrail: Story = {
  render: () => <ExitReasonBadge reason="TRAILING_STOP" />,
};

export const TradingLive: Story = {
  render: () => <TradingModeBadge liveTrading={true} />,
};

export const TradingPaper: Story = {
  render: () => <TradingModeBadge liveTrading={false} />,
};

export const StatusRunning: Story = {
  render: () => <StatusBadge running={true} pid={12345} />,
};

export const StatusStopped: Story = {
  render: () => <StatusBadge running={false} />,
};

export const StatusUnknown: Story = {
  render: () => <StatusBadge running={false} statusUnknown={true} />,
};
