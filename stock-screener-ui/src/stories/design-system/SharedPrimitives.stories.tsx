import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, For } from "solid-js";
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

// Matches the NIFTY snapshot used by the App primitives stories.
const NIFTY_SPOT = 23_450.85;
const FILTER_LABELS = ["Large cap", "Positive", "NIFTY 500"];

export const SectionHeaders: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <SectionHeader title="Market breadth" badge={12} color="primary" />
        <SectionHeader title="Sector rotation" badge="LIVE" color="success" />
        <SectionHeader title="Risk" color="warning" />
      </Stack>
    )),
};

export const FilterStatus: Story = {
  render: () =>
    solidStory(() => {
      const [checked, setChecked] = createSignal<boolean[]>([true, true, false]);
      const hasFilters = () => checked().some(Boolean);
      const clearAll = () => setChecked(FILTER_LABELS.map(() => false));
      return (
        <Box style={{ width: "640px" }}>
          <FilterStatusRow testId="story-filter-status" hasFilters={hasFilters()} onClearAll={clearAll}>
            <For each={FILTER_LABELS}>
              {(label, index) => (
                <Chip
                  label={label}
                  checked={checked()[index()]}
                  onChange={(next) =>
                    setChecked((prev) => prev.map((value, i) => (i === index() ? next : value)))
                  }
                />
              )}
            </For>
          </FilterStatusRow>
        </Box>
      );
    }),
};

export const RangeControl: Story = {
  render: () =>
    solidStory(() => {
      const [min, setMin] = createSignal<number | null>(10);
      const [max, setMax] = createSignal<number | null>(80);
      return (
        <Box style={{ width: "420px" }}>
          <RangeInput
            label="52-week distance"
            domain={[0, 100]}
            min={min()}
            max={max()}
            onMinChange={(value) => setMin(value)}
            onMaxChange={(value) => setMax(value)}
            step={1}
            formatValue={(v) => `${v}%`}
            testId="story-range"
          />
          <Text size="xs" c="dimmed" style={{ "margin-top": "8px" }}>
            Selection: {min() ?? "unbounded"}% – {max() ?? "unbounded"}%
          </Text>
        </Box>
      );
    }),
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
    solidStory(() => {
      const [resets, setResets] = createSignal(0);
      return (
        <Stack gap="lg" style={{ "max-width": "640px" }}>
          <Group gap="md" align="center">
            <Text size="sm">Animated values:</Text>
            <AnimatedValue value={NIFTY_SPOT} format={(v) => v.toLocaleString("en-IN", { minimumFractionDigits: 2 })} />
            <AnimatedValue value={1240.5} />
            <AnimatedValue value={null} />
          </Group>
          <TableEmptyState
            message="No rows for this filter"
            action={
              <Button size="xs" onClick={() => setResets((n) => n + 1)}>
                Reset filters
              </Button>
            }
          />
          <Text size="xs" c="dimmed">{`Filter resets: ${resets()}`}</Text>
          <TableLoadingState message="Loading paper positions" />
          <BrokerAuthNotice connectTestId="story-connect" />
        </Stack>
      );
    }),
};

export const TradeStats: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ "max-width": "760px" }}>
        <TradeStatsGrid
          trades={[{ pnl: 120, net_pnl: 110 }, { pnl: -40, net_pnl: -48 }, { pnl: 80, net_pnl: 72 }]}
          // Gross profit 200 / gross loss 40 = 5.0; net P&L 134 = 110 - 48 + 72.
          summary={{ win_rate: 66.7, profit_factor: 5.0, net_pnl: 134, winners: 2, losers: 1 }}
          isRunning={false}
          emptyText="No closed trades yet"
          testId="story-trade-stats"
        />
      </Box>
    )),
};
