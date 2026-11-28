import type { Meta, StoryObj } from "@storybook/html-vite";
import { RsiAdxScatterView } from "@/components/market/RsiAdxScatterView";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { RSI_ADX_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type RsiAdxArgs = { scenario: "data" | "empty" };

const meta: Meta<RsiAdxArgs> = {
  title: "App/Components/RsiAdxScatterView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'RSI × ADX' scatter from src/components/market/RsiAdxScatterView.tsx. " +
          "RSI is horizontal, ADX vertical, marker area follows √market cap and hue follows the " +
          "day change on the diverging P&L ramp. Reference lines split weak, trending and " +
          "overbought quadrants. Rows missing either indicator are not plotted.",
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
type Story = StoryObj<RsiAdxArgs>;

const rsiAdxStory = (args: RsiAdxArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="RSI × ADX · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="12 names · RSI 38–72 · ADX 16–34"
        testId="story-rsi-adx-frame"
      >
        <ChartStage>
          <RsiAdxScatterView rows={args.scenario === "data" ? RSI_ADX_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => rsiAdxStory(args),
};

/** No row carries both RSI and ADX, so the empty message replaces the canvas. */
export const Empty: Story = {
  render: (args) => rsiAdxStory({ ...args, scenario: "empty" }),
};
