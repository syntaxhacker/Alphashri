import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Chip, Group, Stack, Text } from "@/ui";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { BrokerAuthNotice } from "@/components/common/BrokerAuthNotice";
import { FilterStatusRow } from "@/components/common/FilterStatusRow";
import { RangeInput } from "@/components/common/RangeInput";
import { SectionHeader } from "@/components/common/SectionHeader";
import { Sparkline } from "@/components/common/Sparkline";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import { TradeStatsGrid } from "@/components/common/TradeStatsGrid";

const meta: Meta = { title: "Design System/Shared primitives", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const SectionHeaders: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <SectionHeader title="Market breadth" badge={12} color="blue" />
        <SectionHeader title="Sector rotation" badge="LIVE" color="green" />
        <SectionHeader title="Risk" color="orange" />
      </Stack>
    )),
};

export const FilterStatus: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "640px" }}>
        <FilterStatusRow testId="story-filter-status" hasFilters onClearAll={() => {}}>
          <Chip label="Large cap" defaultChecked />
          <Chip label="Positive" defaultChecked />
          <Chip label="NIFTY 500" />
        </FilterStatusRow>
      </Box>
    )),
};

export const RangeControl: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "420px" }}>
        <RangeInput
          label="52-week distance"
          domain={[0, 100]}
          min={10}
          max={80}
          step={1}
          formatValue={(v) => `${v}%`}
        />
      </Box>
    )),
};

export const Sparklines: Story = {
  render: () =>
    solidStory(() => (
      <Group gap="lg" align="center">
        <Sparkline values={[3, 4, 3.5, 6, 5, 7, 8]} color="var(--color-fin-positive)" testId="up" />
        <Sparkline values={[8, 7, 7.5, 6, 5, 4, 3]} color="var(--color-fin-negative)" testId="down" />
        <Sparkline values={[1, 2, 1, 2, 3, 2, 4]} color="var(--color-fin-primary)" animate />
        <Sparkline values={[1, 2, 3, 4]} responsive width={120} height={32} color="var(--color-fin-warning)" />
      </Group>
    )),
};

export const ValuesAndStates: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "640px" }}>
        <Group gap="md" align="center">
          <Text size="sm">Animated values:</Text>
          <AnimatedValue value={23450.85} />
          <AnimatedValue value={1240.5} />
          <AnimatedValue value={null} />
        </Group>
        <TableEmptyState message="No rows for this filter" action={<Button size="xs">Reset filters</Button>} />
        <TableLoadingState message="Loading paper positions" />
        <BrokerAuthNotice connectTestId="story-connect" />
      </Stack>
    )),
};

export const TradeStats: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ "max-width": "760px" }}>
        <TradeStatsGrid
          trades={[{ pnl: 120, net_pnl: 110 }, { pnl: -40, net_pnl: -48 }, { pnl: 80, net_pnl: 72 }]}
          summary={{ win_rate: 66.7, profit_factor: 2.4, net_pnl: 134, winners: 2, losers: 1 }}
          isRunning={false}
          emptyText="No closed trades yet"
          testId="story-trade-stats"
        />
      </Box>
    )),
};
