import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Chip, Flex, Group, Stack, Text } from "@/ui";
import { BrokerAuthNotice } from "@/components/common/BrokerAuthNotice";
import { FilterStatusRow, FILTER_STATUS_CLEAR_ALL_LABEL } from "@/components/common/FilterStatusRow";
import { RangeInput } from "@/components/common/RangeInput";
import { SectionHeader } from "@/components/common/SectionHeader";
import { Sparkline } from "@/components/common/Sparkline";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import { TradeStatsGrid } from "@/components/common/TradeStatsGrid";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

const meta: Meta = {
  title: "App/Shared widgets",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for widgets shared across screen features: section headers, filter status, range input, sparklines, table states, broker notices and trade summaries. Their dedicated pages live under App/Components; this page shows them composed around one frozen screener toolbar.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const components: FamilyComponentRef[] = [
  { id: "app-components-sectionheader--docs", name: "SectionHeader", note: "Title with badge and tone" },
  { id: "app-components-filterstatusrow--docs", name: "FilterStatusRow", note: "Active chips and clear-all" },
  { id: "app-components-rangeinput--docs", name: "RangeInput", note: "Two-ended numeric range" },
  { id: "app-components-sparkline--docs", name: "Sparkline", note: "Inline trend sketch" },
  { id: "app-components-valuesandstates--docs", name: "ValuesAndStates", note: "Live value and table state widgets" },
  { id: "app-components-tradestatsgrid--docs", name: "TradeStatsGrid", note: "Trade summary metrics" },
  { id: "app-components-states--docs", name: "States", note: "Empty, error and inline loading" },
];

const FILTER_LABELS = ["Large cap", "Positive", "NIFTY 500"];
const TREND_UP = [3, 4, 3.5, 6, 5, 7, 8];
const TREND_DOWN = [8, 7, 7.5, 6, 5, 4, 3];

/**
 * The chip strip is a fixed 24px, horizontally scrolling row. Its clear-all
 * button is pinned inside that same row, which collides with the last chip on
 * a phone. Below 640px the action moves to its own row below the chips.
 */
const useNarrowHost = () => {
  const [narrow, setNarrow] = createSignal(false);
  onMount(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  });
  return narrow;
};

const ToolbarSpecimen = () => {
  const [checked, setChecked] = createSignal<boolean[]>([true, true, false]);
  const narrow = useNarrowHost();
  const clearAll = () => setChecked(FILTER_LABELS.map(() => false));
  return (
    <Stack gap="sm" style={{ "max-width": "760px" }}>
      <SectionHeader title="Market breadth" badge={12} color="primary" />
      <FilterStatusRow
        testId="story-hero-filter-status"
        hasFilters={checked().some(Boolean)}
        onClearAll={narrow() ? undefined : clearAll}
      >
        <For each={FILTER_LABELS}>
          {(label, index) => (
            <Chip
              label={label}
              checked={checked()[index()]}
              onChange={(next) => setChecked((prev) => prev.map((value, i) => (i === index() ? next : value)))}
            />
          )}
        </For>
      </FilterStatusRow>
      <Show when={narrow()}>
        <Flex justify="flex-end" wrap="wrap">
          <Button size="xs" variant="subtle" onClick={clearAll} data-testid="story-hero-filter-clear-all">
            {FILTER_STATUS_CLEAR_ALL_LABEL}
          </Button>
        </Flex>
      </Show>
      <Flex gap="lg" align="center" wrap="wrap">
        <Text size="xs" c="dimmed"> breadth trend</Text>
        <Sparkline values={TREND_UP} color="var(--color-fin-positive)" testId="hero-up" />
        <Sparkline values={TREND_DOWN} color="var(--color-fin-negative)" testId="hero-down" />
      </Flex>
    </Stack>
  );
};

const RangeSpecimen = () => {
  const [min, setMin] = createSignal<number | null>(10);
  const [max, setMax] = createSignal<number | null>(80);
  return (
    <Flex gap="lg" align="center" wrap="wrap">
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
          Selection: {min() ?? "unbounded"}% to {max() ?? "unbounded"}%
        </Text>
      </Box>
      <Group gap="lg" align="center" wrap="wrap">
        <Sparkline values={TREND_UP} color="var(--color-fin-positive)" testId="up" />
        <Sparkline values={TREND_DOWN} color="var(--color-fin-negative)" testId="down" />
        <Sparkline values={[1, 2, 1, 2, 3, 2, 4]} color="var(--color-fin-primary)" testId="primary" />
      </Group>
    </Flex>
  );
};

const TableStatesSpecimen = () => {
  const [resets, setResets] = createSignal(0);
  return (
    <Stack gap="md" style={{ "max-width": "640px" }}>
      <TableEmptyState
        message="No rows for this filter"
        action={<Button size="xs" onClick={() => setResets((n) => n + 1)}>Reset filters</Button>}
      />
      <Text size="xs" c="dimmed">
        {resets() === 0 ? "Reset the filters to widen the search." : "Filters cleared — widen the range to see rows."}
      </Text>
      <TableLoadingState message="Loading paper positions" />
      <BrokerAuthNotice connectTestId="story-connect" />
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage>
        <FamilyHero
          name="Shared primitives"
          count={components.length}
          caption="screener toolbar"
          purpose="Widgets owned by screen features but reused across them: headers, filter chips, range controls, sparklines, table states, broker notices and trade summaries. Keeping them here means a screener and a paper page show the same empty row and the same filter chip."
          specimen={<ToolbarSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="Range and sparklines" note="A bounded selection plus three frozen trend shapes, without motion.">
          <RangeSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Table states" note="Empty, loading and connect-notice states share one layout.">
          <TableStatesSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Trade stats" note="Frozen three-trade summary; gross and net figures stay readable at a glance.">
          <Box style={{ "max-width": "760px" }}>
            <TradeStatsGrid
              trades={[{ pnl: 120, net_pnl: 110 }, { pnl: -40, net_pnl: -48 }, { pnl: 80, net_pnl: 72 }]}
              summary={{ win_rate: 66.7, profit_factor: 5.0, net_pnl: 134, winners: 2, losers: 1 }}
              isRunning={false}
              emptyText="No closed trades yet"
              testId="story-trade-stats"
            />
          </Box>
        </SpecimenPanel>
        <FamilyFooter source="src/components/common" pages="src/stories/components/app" />
      </FamilyPage>
    )),
};
