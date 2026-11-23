import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal, For } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Anchor, Badge, Box, Button, Card, Chip, Divider, Flex, Group, Paper, Stack, Text, Title } from "@/ui";
import { BrokerAuthNotice } from "@/components/common/BrokerAuthNotice";
import { FilterStatusRow } from "@/components/common/FilterStatusRow";
import { RangeInput } from "@/components/common/RangeInput";
import { SectionHeader } from "@/components/common/SectionHeader";
import { Sparkline } from "@/components/common/Sparkline";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import { TradeStatsGrid } from "@/components/common/TradeStatsGrid";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Shared primitives",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for widgets shared across screen features: section headers, filter status, range input, sparklines, table states, broker notices and trade summaries. Their dedicated pages live under Design System/Components/App; this page shows them composed around one frozen screener toolbar.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const docsHref = (id: string) => `../?path=/docs/${id}`;
const DocsLink = (props: { id: string; label: string }) => (
  <Anchor href={docsHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

type ComponentRef = { id: string; name: string; note: string };
const components: ComponentRef[] = [
  { id: "design-system-components-app-sectionheader--docs", name: "SectionHeader", note: "Title with badge and tone" },
  { id: "design-system-components-app-filterstatusrow--docs", name: "FilterStatusRow", note: "Active chips and clear-all" },
  { id: "design-system-components-app-rangeinput--docs", name: "RangeInput", note: "Two-ended numeric range" },
  { id: "design-system-components-app-sparkline--docs", name: "Sparkline", note: "Inline trend sketch" },
  { id: "design-system-components-app-valuesandstates--docs", name: "ValuesAndStates", note: "Live value and table state widgets" },
  { id: "design-system-components-app-tradestatsgrid--docs", name: "TradeStatsGrid", note: "Trade summary metrics" },
  { id: "design-system-components-app-states--docs", name: "States", note: "Empty, error and inline loading" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component pages</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">At a glance · screener toolbar</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open each card to reach its dedicated page.</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <DocsLink id={item.id} label={item.name} />
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

const Specimen = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

const FILTER_LABELS = ["Large cap", "Positive", "NIFTY 500"];
const TREND_UP = [3, 4, 3.5, 6, 5, 7, 8];
const TREND_DOWN = [8, 7, 7.5, 6, 5, 4, 3];

const ToolbarSpecimen = () => {
  const [checked, setChecked] = createSignal<boolean[]>([true, true, false]);
  const clearAll = () => setChecked(FILTER_LABELS.map(() => false));
  return (
    <Stack gap="sm" style={{ "max-width": "760px" }}>
      <SectionHeader title="Market breadth" badge={12} color="primary" />
      <FilterStatusRow
        testId="story-hero-filter-status"
        hasFilters={checked().some(Boolean)}
        onClearAll={clearAll}
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
      <Text size="xs" c="dimmed">{`Filter resets: ${resets()}`}</Text>
      <TableLoadingState message="Loading paper positions" />
      <BrokerAuthNotice connectTestId="story-connect" />
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Shared primitives"
          count={components.length}
          purpose="Widgets owned by screen features but reused across them: headers, filter chips, range controls, sparklines, table states, broker notices and trade summaries. Keeping them here means a screener and a paper page show the same empty row and the same filter chip."
          specimen={<ToolbarSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Range and sparklines" note="A bounded selection plus three frozen trend shapes, without motion.">
          <RangeSpecimen />
        </Specimen>
        <Specimen title="Table states" note="Empty, loading and connect-notice states share one layout.">
          <TableStatesSpecimen />
        </Specimen>
        <Specimen title="Trade stats" note="Frozen three-trade summary; gross and net figures stay readable at a glance.">
          <Box style={{ "max-width": "760px" }}>
            <TradeStatsGrid
              trades={[{ pnl: 120, net_pnl: 110 }, { pnl: -40, net_pnl: -48 }, { pnl: 80, net_pnl: 72 }]}
              summary={{ win_rate: 66.7, profit_factor: 5.0, net_pnl: 134, winners: 2, losers: 1 }}
              isRunning={false}
              emptyText="No closed trades yet"
              testId="story-trade-stats"
            />
          </Box>
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/components/common</code> · per-component pages: <code>src/stories/components/App</code>.</Text>
      </Stack>
    )),
};
