import type { Meta, StoryObj } from "@storybook/html-vite";
import { SectorPeriodView } from "@/components/market/SectorPeriodView";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { MARKET_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type PeriodArgs = { scenario: "data" | "empty" };

const meta: Meta<PeriodArgs> = {
  title: "App/Components/SectorPeriodView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'Sector × period' renderer from src/components/market/SectorPeriodView.tsx: " +
          "a diverging grid of sector medians for 1D, 1W and 1M performance. The fixture carries " +
          "both positive and negative weekly/monthly readings so both sides of the ramp are visible.",
      },
    },
  },
  args: { scenario: "data" },
  argTypes: {
    scenario: {
      control: "inline-radio",
      options: ["data", "empty"],
      description: "Frozen rows or the filtered-to-nothing state.",
    },
  },
};
export default meta;
type Story = StoryObj<PeriodArgs>;

const periodStory = (args: PeriodArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Sector × period · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="1D / 1W / 1M medians · diverging VIZ ramp"
        testId="story-sector-period-frame"
      >
        <ChartStage>
          <SectorPeriodView rows={args.scenario === "data" ? MARKET_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => periodStory(args),
};

/** No usable sector performance readings leaves the explicit empty message. */
export const Empty: Story = {
  render: (args) => periodStory({ ...args, scenario: "empty" }),
};
