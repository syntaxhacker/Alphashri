import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Group, Stack, Text } from "@/ui";
import { KeyValue } from "@/components/common/KeyValue";
import { ExitReasonBadge, SideBadge, StatusBadge, TradingModeBadge } from "@/components/common/BadgeComponents";
import { PnlText } from "@/components/common/PnlText";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";

const meta: Meta = { title: "Design System/App primitives", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

// One labelled quote fixture shared by every story in this group: spot, change
// and OI are a single frozen snapshot. The expiry is relative to the IST
// session so a fixed weekly date can never become a past-dated promise.
const NIFTY_FIXTURE_LABEL = "frozen NIFTY quote fixture";
const NIFTY_SPOT = 23_450.85;
const NIFTY_SPOT_LABEL = "23,450.85";
const NIFTY_CHANGE = 18.42;
const NIFTY_CHANGE_PCT = 0.08;
const NIFTY_MAX_PAIN = "23,400";
const AS_OF = "12:03:15 IST";
const NIFTY_EXPIRY = (() => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const sessionUtc = Date.UTC(part("year"), part("month") - 1, part("day"));
  const daysToThursday = (4 - new Date(sessionUtc).getUTCDay() + 7) % 7;
  const expiry = new Date(sessionUtc + daysToThursday * 86_400_000);
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
  }).format(expiry);
  return `${label} · next weekly`;
})();

interface MarketRow {
  symbol: string;
  ltp: number;
  chg: number;
  oi: number;
}

const marketRows: MarketRow[] = [
  { symbol: "NIFTY", ltp: NIFTY_SPOT, chg: NIFTY_CHANGE_PCT, oi: 1_204_500 },
  { symbol: "BANKNIFTY", ltp: 51_284.5, chg: -0.18, oi: 884_200 },
  { symbol: "FINNIFTY", ltp: 23_410.2, chg: 0.12, oi: 402_100 },
  { symbol: "MIDCPNIFTY", ltp: 12_884.0, chg: -0.44, oi: 118_900 },
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
      <span
        style={{
          color: row.original.chg >= 0 ? "var(--color-fin-positive)" : "var(--color-fin-negative)",
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {row.original.chg >= 0 ? "+" : ""}
        {row.original.chg.toFixed(2)}
      </span>
    ),
  },
  { id: "oi", header: "OI", accessorKey: "oi", meta: { align: "right" } },
];

export const KeyValueRows: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="xs" style={{ width: "320px" }}>
        <Text size="xs" c="dimmed">{NIFTY_FIXTURE_LABEL}</Text>
        <KeyValue
          label="Spot"
          value={NIFTY_SPOT_LABEL}
          hint={`+${NIFTY_CHANGE} (${NIFTY_CHANGE_PCT.toFixed(2)}%)`}
          tone="success"
          mono
          testId="spot"
        />
        <KeyValue label="Expiry" value={NIFTY_EXPIRY} align="left" />
        <KeyValue label="PCR (OI)" value="1.12" dense />
        <KeyValue label="Max pain" value={NIFTY_MAX_PAIN} align="left" />
        <KeyValue label="Updated (fixture)" value={AS_OF} tone="dimmed" />
      </Stack>
    )),
};

export const MarketBadges: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <Group gap="sm" align="center">
          <SideBadge side="BUY" />
          <SideBadge side="SELL" />
          <ExitReasonBadge reason="TP" />
          <ExitReasonBadge reason="SL" />
          <ExitReasonBadge reason="TRAILING_STOP" />
          <ExitReasonBadge reason="52W Target" />
          <StatusBadge running />
          <StatusBadge running={false} statusUnknown />
          <TradingModeBadge liveTrading />
          <TradingModeBadge liveTrading={false} />
        </Group>
        <Group gap="lg" align="center">
          <PnlText value={1240.5} />
          <PnlText value={-318.25} />
          <PnlText value={0} />
        </Group>
      </Stack>
    )),
};

export const States: Story = {
  render: () =>
    solidStory(() => {
      const [attempts, setAttempts] = createSignal(0);
      const [failed, setFailed] = createSignal(true);
      return (
        <Stack gap="lg" style={{ "max-width": "620px" }}>
          <EmptyState title="No rows for this filter" description="Widen the strike range or switch expiry." />
          <Show
            when={failed()}
            fallback={
              <Text size="xs" c="success">
                {`Tape reloaded after ${attempts()} retry${attempts() === 1 ? "" : "ies"}.`}
              </Text>
            }
          >
            <ErrorAlert
              title="Feed unavailable"
              message="The options tape returned 503."
              withRetry
              onRetry={() => {
                setAttempts((n) => n + 1);
                setFailed(false);
              }}
            />
          </Show>
          <InlineLoader message="Loading option chain" />
          <Text size="xs" c="dimmed">
            Shared app primitives keep the same spacing, type scale and semantic tones as the design system.
          </Text>
        </Stack>
      );
    }),
};

export const CompactPanels: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ width: "720px" }}>
        <CompactPanel title={`NIFTY option chain · ${NIFTY_FIXTURE_LABEL}`} description={`Spot ${NIFTY_SPOT_LABEL} · ${NIFTY_EXPIRY} expiry`}>
          <Text size="xs" c="dimmed">458 strike rows · {AS_OF}</Text>
        </CompactPanel>
        <CompactStatGrid cols={4}>
          <CompactStat
            label="Spot"
            value={NIFTY_SPOT_LABEL}
            hint={`+${NIFTY_CHANGE} (${NIFTY_CHANGE_PCT.toFixed(2)}%)`}
            tone="success"
          />
          <CompactStat label="PCR (OI)" value="1.12" tone="success" />
          <CompactStat label="Max Pain" value={NIFTY_MAX_PAIN} />
          <CompactStat label="Pin Risk" value="HIGH" tone="warning" />
        </CompactStatGrid>
      </Stack>
    )),
};

export const TableNormal: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="xs" style={{ width: "640px" }}>
        <Text size="xs" c="dimmed">{`${NIFTY_FIXTURE_LABEL} · NIFTY ${NIFTY_SPOT_LABEL} · ${NIFTY_EXPIRY} expiry · ${AS_OF}`}</Text>
        <TanStackTable
          data={marketRows}
          columns={marketColumns}
          dataTestId="story-table-normal"
          ariaLabel="Index quotes, normal density"
          stickyHeader
        />
      </Stack>
    )),
};

export const TableDense: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="xs" style={{ width: "640px" }}>
        <Text size="xs" c="dimmed">{`${NIFTY_FIXTURE_LABEL} · NIFTY ${NIFTY_SPOT_LABEL} · ${NIFTY_EXPIRY} expiry · ${AS_OF}`}</Text>
        <TanStackTable
          data={marketRows}
          columns={marketColumns}
          dataTestId="story-table-dense"
          ariaLabel="Index quotes, dense mode"
          dense
          stickyHeader
        />
      </Stack>
    )),
};
