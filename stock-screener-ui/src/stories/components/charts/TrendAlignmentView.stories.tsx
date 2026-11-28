import type { Meta, StoryObj } from "@storybook/html-vite";
import { TrendAlignmentView } from "@/components/market/TrendAlignmentView";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { SNAPSHOT_LABEL, TREND_ROWS } from "./market.fixtures";

type TrendArgs = { scenario: "data" | "empty" };

const meta: Meta<TrendArgs> = {
  title: "App/Components/TrendAlignmentView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'Trend alignment' matrix from src/components/market/TrendAlignmentView.tsx: " +
          "one row per stock with three MA-status dots (20/50/200), an aligned-count label and the " +
          "signed day change. The chips filter 3/3, 2+ and below-200; rows whose three averages are " +
          "all missing are dropped.",
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
type Story = StoryObj<TrendArgs>;

const trendStory = (args: TrendArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Trend alignment · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="20 / 50 / 200-day MA · 3/3 · 2+ · below 200"
        testId="story-trend-alignment-frame"
      >
        <ChartStage>
          <TrendAlignmentView rows={args.scenario === "data" ? TREND_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => trendStory(args),
};

/** No moving-average data means there is no alignment to show. */
export const Empty: Story = {
  render: (args) => trendStory({ ...args, scenario: "empty" }),
};
