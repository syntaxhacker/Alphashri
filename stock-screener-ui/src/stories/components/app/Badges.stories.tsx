import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, Group, Stack } from "@/ui";
import {
  ExitReasonBadge,
  SideBadge,
  StatusBadge,
  TradingModeBadge,
} from "@/components/common/BadgeComponents";
import { PnlBadge, PnlText } from "@/components/common/PnlText";
import { BadgeCell } from "@/components/common/tableCells";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen trade + feed badges · 2026-11-20 15:10 IST";

type BadgeArgs = {
  side: string;
  reason: string;
  liveTrading: boolean;
  running: boolean;
  statusUnknown: boolean;
  pid: number;
  pnl: number;
};

const meta: Meta<BadgeArgs> = {
  title: "App/Components/Badges",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The shared trading/market badge family from src/components/common/BadgeComponents.tsx " +
          "plus P&L and table badges. These are the components the existing catalog calls " +
          "'market badges' — there is no literal `MarketBadge` component in the tree. " +
          "Side, exit reason, status and trading mode are derived from typed inputs, never from " +
          "string-matched error copy.",
      },
    },
  },
  args: {
    side: "BUY",
    reason: "TP",
    liveTrading: false,
    running: true,
    statusUnknown: false,
    pid: 4821,
    pnl: 1240.5,
  },
  argTypes: {
    side: { control: "select", options: ["BUY", "SELL", "LONG", "SHORT"], description: "SideBadge side; BUY/LONG are success, others error." },
    reason: {
      control: "select",
      options: ["TP", "SL", "TRAILING_STOP", "MAX_HOLD", "FORCE_CLOSE", "52W Target", "MANUAL"],
      description: "ExitReasonBadge code; tone and compact label are derived from the reason.",
    },
    liveTrading: { control: "boolean", description: "TradingModeBadge: LIVE (error) vs PAPER (success)." },
    running: { control: "boolean", description: "StatusBadge: RUNNING vs STOPPED/UNKNOWN." },
    statusUnknown: { control: "boolean", description: "StatusBadge unknown state (warning). Only matters when not running." },
    pid: { control: "number", description: "Optional process id appended to the status label." },
    pnl: { control: "number", description: "Signed P&L used to pick the semantic text colour." },
  },
};
export default meta;
type Story = StoryObj<BadgeArgs>;

const BadgeStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** All market/trade badges together, mirroring the existing catalog's group. */
export const MarketBadges: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Badges · market and trade family"
          detail={FIXTURE_LABEL}
          meta={`side ${args.side} · reason ${args.reason} · pid ${args.pid}`}
          testId="story-badges-market-frame"
        >
          <Stack gap="md">
            <Specimen label="Trade status">
              <BadgeStrip>
                <Group gap="sm" align="center" wrap="wrap">
                  <SideBadge side={args.side} />
                  <SideBadge side="SELL" />
                  <ExitReasonBadge reason={args.reason} />
                  <StatusBadge running={args.running} statusUnknown={args.statusUnknown} pid={args.pid} />
                  <TradingModeBadge liveTrading={args.liveTrading} />
                </Group>
              </BadgeStrip>
            </Specimen>
            <Specimen label="P&L tones">
              <BadgeStrip>
                <Group gap="lg" align="center" wrap="wrap">
                  <PnlText value={args.pnl} />
                  <PnlText value={-318.25} />
                  <PnlText value={0} />
                </Group>
              </BadgeStrip>
            </Specimen>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const Sides: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel title="Badges · sides" detail={FIXTURE_LABEL} meta="4 side tokens" testId="story-badges-sides-frame">
          <BadgeStrip>
            <Group gap="sm" align="center" wrap="wrap">
              <SideBadge side="BUY" data-testid="story-side-buy" />
              <SideBadge side="SELL" data-testid="story-side-sell" />
              <SideBadge side="LONG" />
              <SideBadge side="SHORT" />
            </Group>
          </BadgeStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Every compact exit label / tone branch with a frozen reason string. */
export const ExitReasons: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Badges · exit reasons"
          detail={FIXTURE_LABEL}
          meta="11 frozen reason strings"
          testId="story-badges-reasons-frame"
        >
          <BadgeStrip>
            <Group gap="sm" align="center" wrap="wrap">
              <ExitReasonBadge reason="TP" />
              <ExitReasonBadge reason="take profit" />
              <ExitReasonBadge reason="SL" />
              <ExitReasonBadge reason="stop_loss" />
              <ExitReasonBadge reason="TRAILING_STOP" />
              <ExitReasonBadge reason="MAX_HOLD" />
              <ExitReasonBadge reason="FORCE_CLOSE" />
              <ExitReasonBadge reason="52W Target" />
              <ExitReasonBadge reason="MANUAL" />
              <ExitReasonBadge reason="unclassified" />
              <ExitReasonBadge reason="" />
            </Group>
          </BadgeStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

export const StatusAndMode: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel title="Badges · status and mode" detail={FIXTURE_LABEL} meta="3 status · 2 mode" testId="story-badges-status-frame">
          <Stack gap="sm">
            <BadgeStrip>
              <Group gap="sm" align="center" wrap="wrap">
                <StatusBadge running pid={4821} />
                <StatusBadge running={false} />
                <StatusBadge running={false} statusUnknown />
              </Group>
            </BadgeStrip>
            <BadgeStrip>
              <Group gap="sm" align="center" wrap="wrap">
                <TradingModeBadge liveTrading />
                <TradingModeBadge liveTrading={false} />
              </Group>
            </BadgeStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const PnlBadgesAndCells: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel title="Badges · P&L and table cells" detail={FIXTURE_LABEL} meta="3 P&L · 4 status" testId="story-badges-pnl-frame">
          <Stack gap="sm">
            <BadgeStrip>
              <Group gap="sm" align="center" wrap="wrap">
                <PnlBadge value={1240.5}>+₹1,240.50</PnlBadge>
                <PnlBadge value={-318.25}>-₹318.25</PnlBadge>
                <PnlBadge value={0}>₹0</PnlBadge>
              </Group>
            </BadgeStrip>
            <BadgeStrip>
              <Group gap="md" align="center" wrap="wrap">
                <BadgeCell label="LIVE" color="error" variant="filled" title="Live feed" />
                <BadgeCell label="PAPER" color="success" />
                <BadgeCell label="DELAYED" color="warning" variant="outline" />
                <BadgeCell label="STALE" color="info" variant="light" />
              </Group>
            </BadgeStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
