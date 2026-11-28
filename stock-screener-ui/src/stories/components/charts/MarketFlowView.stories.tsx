import type { Meta, StoryObj } from "@storybook/html-vite";
import { MarketFlowView } from "@/components/market/MarketFlowView";
import type { MarketRow } from "@/types/marketScreener";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { INFLOW_ROWS, MARKET_ROWS, OUTFLOW_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type FlowArgs = {
  scenario: "inflow" | "outflow" | "mixed" | "empty";
  currency: "INR" | "USD";
};

const meta: Meta<FlowArgs> = {
  title: "App/Components/MarketFlowView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'Money flow' renderer from src/components/market/MarketFlowView.tsx. " +
          "One annular sector per market sector: fill is the median session change, outer radius is " +
          "turnover and the dashed rail (with its arrowhead) is the signed-turnover proxy. It is a " +
          "proxy, never observed buy/sell flow. The same sectors appear in the heatmap to the right.",
      },
    },
  },
  args: { scenario: "mixed", currency: "INR" },
  argTypes: {
    scenario: {
      control: "inline-radio",
      options: ["inflow", "outflow", "mixed", "empty"],
      description: "Frozen session slice: all-inflow, all-outflow, mixed or no rows.",
    },
    currency: {
      control: "inline-radio",
      options: ["INR", "USD"],
      description: "Amount grouping and symbol for the turnover labels.",
    },
  },
};
export default meta;
type Story = StoryObj<FlowArgs>;

const rowsFor = (args: FlowArgs): MarketRow[] => {
  switch (args.scenario) {
    case "inflow":
      return INFLOW_ROWS;
    case "outflow":
      return OUTFLOW_ROWS;
    case "empty":
      return [];
    default:
      return MARKET_ROWS;
  }
};

const flowStory = (args: FlowArgs, note: string) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Money flow · sector ring"
        detail={SNAPSHOT_LABEL}
        meta={note}
        testId="story-market-flow-frame"
      >
        <ChartStage height={500}>
          <MarketFlowView rows={rowsFor(args)} currency={args.currency} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => flowStory(args, "turnover radius · median-change fill · signed-turnover rail"),
};

/** Every rail points inward; the centre total is the session's turnover. */
export const InflowSession: Story = {
  render: (args) => flowStory({ ...args, scenario: "inflow" }, "8 advancers · inflow rails"),
};

/** Every rail points outward; the same geometry must not imply buying. */
export const OutflowSession: Story = {
  render: (args) => flowStory({ ...args, scenario: "outflow" }, "7 decliners · outflow rails"),
};

export const MixedSession: Story = {
  render: (args) => flowStory({ ...args, scenario: "mixed" }, "18 NSE names across 14 sectors"),
};

/** An empty filter has no sectors to draw, so the explicit empty state shows. */
export const Empty: Story = {
  render: (args) => flowStory({ ...args, scenario: "empty" }, "no sector data in the current filter"),
};
