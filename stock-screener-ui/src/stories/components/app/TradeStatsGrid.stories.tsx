import type { Meta, StoryObj } from "@storybook/html-vite";
import { Badge, Box, Text } from "@/ui";
import {
  TradeStatsGrid,
  computeTradeStats,
  formatCurrencySigned,
  type TradeStatsSummaryLike,
  type TradeStatsTradeLike,
} from "@/components/common/TradeStatsGrid";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen paper trade ledger · 2026-11-20 15:10 IST";

const FROZEN_TRADES: readonly TradeStatsTradeLike[] = [
  Object.freeze({ pnl: 120, net_pnl: 110 }),
  Object.freeze({ pnl: -40, net_pnl: -48 }),
  Object.freeze({ pnl: 80, net_pnl: 72 }),
];

// Gross profit 200 / gross loss 40 = 5.0; net P&L 110 - 48 + 72 = 134.
const FROZEN_SUMMARY: TradeStatsSummaryLike = Object.freeze({
  win_rate: 66.7,
  profit_factor: 5.0,
  net_pnl: 134,
  winners: 2,
  losers: 1,
});

type TradeStatsArgs = {
  isRunning: boolean;
  emptyText: string;
};

const meta: Meta<TradeStatsArgs> = {
  title: "App/Components/TradeStatsGrid",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A compact stat strip for trade outcomes (src/components/common/TradeStatsGrid.tsx). " +
          "It accepts either an explicit summary or derives one with `computeTradeStats` from " +
          "the trade rows; `profit_factor: null` is a valid replay summary. `formatCurrencySigned` " +
          "is the shared INR sign formatter. No values are generated at render time.",
      },
    },
  },
  args: {
    isRunning: false,
    emptyText: "No closed trades yet",
  },
  argTypes: {
    isRunning: { control: "boolean", description: "With no trades, keeps the grid mounted and enables the progress stat." },
    emptyText: { control: "text", description: "Copy shown when there are no trades and nothing is running." },
  },
};
export default meta;
type Story = StoryObj<TradeStatsArgs>;

/** The strip sits on a raised desk band, the way the paper tab stages it. */
const StatStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

export const Populated: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trade stats · explicit summary"
          detail={FIXTURE_LABEL}
          meta="3 closed trades · net +₹134.00"
          testId="story-trade-stats-frame"
        >
          <Specimen label="Ledger outcome strip" detail="Summary is passed explicitly; nothing is derived at render.">
            <StatStrip>
              <TradeStatsGrid
                trades={FROZEN_TRADES}
                summary={FROZEN_SUMMARY}
                isRunning={args.isRunning}
                emptyText={args.emptyText}
                testId="story-trade-stats"
              />
            </StatStrip>
            <Text size="xs" c="secondary">{`Signed net P&L formatter: ${formatCurrencySigned(134)} / ${formatCurrencySigned(-48)}`}</Text>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};

export const DerivedFromTrades: Story = {
  render: () =>
    solidStory(() => {
      const derived = computeTradeStats(FROZEN_TRADES, null);
      return (
        <DemoStack>
          <DemoPanel
            title="Trade stats · derived summary"
            detail={`${FIXTURE_LABEL} · summary=null → derived: ${JSON.stringify(derived)}`}
            meta="3 closed trades"
            testId="story-trade-stats-derived-frame"
          >
            <StatStrip>
              <TradeStatsGrid
                trades={FROZEN_TRADES}
                summary={null}
                isRunning={false}
                emptyText="No closed trades yet"
                testId="story-trade-stats-derived"
              />
            </StatStrip>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const Empty: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trade stats · empty ledger"
          detail={`${FIXTURE_LABEL} · no trades`}
          meta="0 closed trades"
          testId="story-trade-stats-empty-frame"
        >
          <StatStrip>
            <TradeStatsGrid trades={[]} summary={null} isRunning={args.isRunning} emptyText={args.emptyText} testId="story-trade-stats-empty" />
          </StatStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

export const Running: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trade stats · running"
          detail={`${FIXTURE_LABEL} · running with progress slots`}
          meta="18 / 24 scanned · frozen batch"
          testId="story-trade-stats-running-frame"
        >
          <StatStrip>
            <TradeStatsGrid
              trades={FROZEN_TRADES}
              summary={FROZEN_SUMMARY}
              isRunning
              emptyText="No closed trades yet"
              extraStats={<Badge color="info" variant="light" size="sm">SCANNING</Badge>}
              progressStat={{ value: "18 / 24", hint: "frozen ticker batch" }}
              progressBar={{ percent: 75 }}
              testId="story-trade-stats-running"
            />
          </StatStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Replay summaries legitimately carry a null profit factor. */
export const NullProfitFactor: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trade stats · null profit factor"
          detail={`${FIXTURE_LABEL} · profit_factor null renders an em dash`}
          meta="replay summary · PF = —"
          testId="story-trade-stats-null-pf-frame"
        >
          <StatStrip>
            <TradeStatsGrid
              trades={[]}
              summary={{ win_rate: 50, profit_factor: null, net_pnl: 0, winners: 1, losers: 1 }}
              isRunning
              emptyText="No closed trades yet"
              testId="story-trade-stats-null-pf"
            />
          </StatStrip>
        </DemoPanel>
      </DemoStack>
    )),
};
