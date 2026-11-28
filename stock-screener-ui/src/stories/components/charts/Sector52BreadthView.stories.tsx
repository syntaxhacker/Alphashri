import type { Meta, StoryObj } from "@storybook/html-vite";
import { Sector52BreadthView } from "@/components/market/Sector52BreadthView";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { MARKET_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type BreadthArgs = { scenario: "data" | "empty" };

const meta: Meta<BreadthArgs> = {
  title: "App/Components/Sector52BreadthView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'Sector 52W' renderer from src/components/market/Sector52BreadthView.tsx: " +
          "one bar per sector showing the share of members within a small distance of their " +
          "52-week high or low, plus the median day change. The toggle switches the measure; " +
          "sectors with no usable range never contribute a bar.",
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
type Story = StoryObj<BreadthArgs>;

const breadthStory = (args: BreadthArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Sector 52-week breadth · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="near high / near low toggle · 11 sectors"
        testId="story-sector-52w-breadth-frame"
      >
        <ChartStage>
          <Sector52BreadthView rows={args.scenario === "data" ? MARKET_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => breadthStory(args),
};

/** No sector carries a usable 52-week range, so no breadth bars are drawn. */
export const Empty: Story = {
  render: (args) => breadthStory({ ...args, scenario: "empty" }),
};
