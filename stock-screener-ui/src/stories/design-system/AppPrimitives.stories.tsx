import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Badge, Button, Flex, Group, Stack, Text } from "@/ui";
import { KeyValue } from "@/components/common/KeyValue";
import { ExitReasonBadge, SideBadge, StatusBadge, TradingModeBadge } from "@/components/common/BadgeComponents";
import { PnlText } from "@/components/common/PnlText";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

const meta: Meta = {
  title: "Design System/App primitives",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the composed app widgets: key-value rows, semantic badges, empty and error states, compact panels, stat grids and the shared table. Every example reads one frozen NIFTY option-chain fixture; dedicated pages live under Design System/Components/App.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const components: FamilyComponentRef[] = [
  { id: "design-system-components-app-badges--docs", name: "Badges", note: "Side, status, exit and mode badges" },
  { id: "design-system-components-app-compactpanels--docs", name: "CompactPanels", note: "Titled panel with a stat grid" },
  { id: "design-system-components-app-errorboundary--docs", name: "ErrorBoundary", note: "Contain a failed render" },
  { id: "design-system-components-app-filterstatusrow--docs", name: "FilterStatusRow", note: "Active chips and clear-all" },
  { id: "design-system-components-app-icons--docs", name: "Icons", note: "Terminal icon vocabulary" },
  { id: "design-system-components-app-keyvalue--docs", name: "KeyValue", note: "Label, value, hint and tone" },
  { id: "design-system-components-app-minilinechart--docs", name: "MiniLineChart", note: "Compact trend line" },
  { id: "design-system-components-app-papertradingtable--docs", name: "PaperTradingTable", note: "Positions and trades grid" },
  { id: "design-system-components-app-rangeinput--docs", name: "RangeInput", note: "Two-ended numeric range" },
  { id: "design-system-components-app-sectionheader--docs", name: "SectionHeader", note: "Title with badge and tone" },
  { id: "design-system-components-app-sparkline--docs", name: "Sparkline", note: "Inline trend sketch" },
  { id: "design-system-components-app-states--docs", name: "States", note: "Empty, error and inline loading" },
  { id: "design-system-components-app-symbollink--docs", name: "SymbolLink", note: "Symbol with chart navigation" },
  { id: "design-system-components-app-tablecells--docs", name: "TableCells", note: "Shared cell renderers" },
  { id: "design-system-components-app-tanstacktable--docs", name: "TanStackTable", note: "Dense, aligned data grid" },
  { id: "design-system-components-app-tradestatsgrid--docs", name: "TradeStatsGrid", note: "Trade summary metrics" },
  { id: "design-system-components-app-tradingdatepicker--docs", name: "TradingDatePicker", note: "Session-aware date choice" },
  { id: "design-system-components-app-valuesandstates--docs", name: "ValuesAndStates", note: "Live value and table state widgets" },
];

// One labelled fixture shared by every example: spot, change and OI are a
// single frozen snapshot so the page never implies a live quote.
const FIXTURE_LABEL = "frozen NIFTY quote fixture";
const SPOT_LABEL = "23,450.85";
const CHANGE = 18.42;
const CHANGE_PCT = 0.08;
const EXPIRY = "19 NOV 2026 · next weekly";
const AS_OF = "12:03:15 IST";

interface MarketRow {
  symbol: string;
  ltp: number;
  chg: number;
  oi: number;
}

const marketRows: MarketRow[] = [
  { symbol: "NIFTY", ltp: 23450.85, chg: 0.08, oi: 1204500 },
  { symbol: "BANKNIFTY", ltp: 51284.5, chg: -0.18, oi: 884200 },
  { symbol: "FINNIFTY", ltp: 23410.2, chg: 0.12, oi: 402100 },
  { symbol: "MIDCPNIFTY", ltp: 12884.0, chg: -0.44, oi: 118900 },
];

const marketColumns: TableColumnDef<MarketRow>[] = [
  { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" } },
  { id: "ltp", header: "LTP", accessorKey: "ltp", meta: { align: "right" } },
  {
    id: "chg",
    header: "Chg %",
    accessorFn: (row) => row.chg,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span style={{ color: row.original.chg >= 0 ? "var(--color-fin-positive)" : "var(--color-fin-negative)", "font-variant-numeric": "tabular-nums" }}>
        {row.original.chg >= 0 ? "+" : ""}{row.original.chg.toFixed(2)}
      </span>
    ),
  },
  { id: "oi", header: "OI", accessorKey: "oi", meta: { align: "right" } },
];

const ChainHeaderSpecimen = () => (
  <Stack gap="sm" style={{ "max-width": "760px" }}>
    <Flex gap="sm" align="center" wrap="wrap">
      <Badge variant="dot" color="success">LIVE</Badge>
      <Text size="xs" c="dimmed">{FIXTURE_LABEL} · {AS_OF}</Text>
    </Flex>
    <CompactPanel title={`NIFTY option chain · ${FIXTURE_LABEL}`} description={`Spot ${SPOT_LABEL} · ${EXPIRY} expiry`}>
      <CompactStatGrid cols={4}>
        <CompactStat label="Spot" value={SPOT_LABEL} hint={`+${CHANGE} (${CHANGE_PCT.toFixed(2)}%)`} tone="success" />
        <CompactStat label="PCR (OI)" value="1.12" tone="success" />
        <CompactStat label="Max pain" value="23,400" />
        <CompactStat label="Pin risk" value="HIGH" tone="warning" />
      </CompactStatGrid>
    </CompactPanel>
  </Stack>
);

const KeyValueSpecimen = () => (
  <Flex gap="lg" align="flex-start" wrap="wrap">
    <Stack gap="xs" style={{ width: "320px" }}>
      <Text size="xs" c="dimmed">{FIXTURE_LABEL}</Text>
      <KeyValue label="Spot" value={SPOT_LABEL} hint={`+${CHANGE} (${CHANGE_PCT.toFixed(2)}%)`} tone="success" mono testId="spot" />
      <KeyValue label="Expiry" value={EXPIRY} align="left" />
      <KeyValue label="PCR (OI)" value="1.12" dense />
      <KeyValue label="Max pain" value="23,400" align="left" />
    </Stack>
    <Stack gap="sm">
      <Text size="xs" c="dimmed">Semantic badges and signed P and L.</Text>
      <Group gap="sm" align="center" wrap="wrap">
        <SideBadge side="BUY" />
        <SideBadge side="SELL" />
        <ExitReasonBadge reason="TP" />
        <ExitReasonBadge reason="SL" />
        <ExitReasonBadge reason="TRAILING_STOP" />
        <StatusBadge running />
        <StatusBadge running={false} statusUnknown />
        <TradingModeBadge liveTrading />
        <TradingModeBadge liveTrading={false} />
      </Group>
      <Group gap="lg" align="center" wrap="wrap">
        <PnlText value={1240.5} />
        <PnlText value={-318.25} />
        <PnlText value={0} />
      </Group>
    </Stack>
  </Flex>
);

const StatesSpecimen = () => {
  const [attempts, setAttempts] = createSignal(0);
  const [failed, setFailed] = createSignal(true);
  return (
    <Stack gap="md" style={{ "max-width": "640px" }}>
      <EmptyState title="No rows for this filter" description="Widen the strike range or switch expiry." />
      <Show
        when={failed()}
        fallback={<Text size="xs" c="success">{`Tape reloaded after ${attempts()} retry${attempts() === 1 ? "" : "ies"}.`}</Text>}
      >
        <ErrorAlert
          title="Feed unavailable"
          message="The options tape returned 503."
          withRetry
          onRetry={() => { setAttempts((n) => n + 1); setFailed(false); }}
        />
      </Show>
      <InlineLoader message="Loading option chain" />
    </Stack>
  );
};

const TableSpecimen = () => {
  const [dense, setDense] = createSignal(false);
  return (
    <Stack gap="sm" style={{ "max-width": "720px" }}>
      <Group gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="dimmed">{`${FIXTURE_LABEL} · NIFTY ${SPOT_LABEL} · ${EXPIRY} · ${AS_OF}`}</Text>
        <Button size="xs" variant="outline" onClick={() => setDense((v) => !v)}>
          {dense() ? "Switch to normal" : "Switch to dense"}
        </Button>
      </Group>
      <TanStackTable
        data={marketRows}
        columns={marketColumns}
        dataTestId="story-table-density"
        ariaLabel={`Index quotes, ${dense() ? "dense" : "normal"} mode`}
        dense={dense()}
        stickyHeader
      />
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage>
        <FamilyHero
          name="App primitives"
          count={components.length}
          caption="NIFTY chain header"
          purpose="Composed widgets the app screens reuse: data rows, semantic badges, state messages, compact stat panels and the shared table. They inherit spacing, type and semantic tones from the same tokens the lower-level primitives use."
          specimen={<ChainHeaderSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="KeyValue and badges" note="One frozen quote rendered as label-value rows and semantic markers.">
          <KeyValueSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Shared states" note="Empty, error with retry and inline loading use the same vocabulary across screens.">
          <StatesSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Table density" note="One grid, one toggle; column alignment stays fixed in both modes.">
          <TableSpecimen />
        </SpecimenPanel>
        <FamilyFooter source="src/components/common" pages="src/stories/components/App" />
      </FamilyPage>
    )),
};
