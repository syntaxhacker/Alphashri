import type { Meta, StoryObj } from "@storybook/html-vite";
import { Range52View } from "@/components/market/Range52View";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { RANGE52_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type Range52Args = { scenario: "data" | "empty" };

const meta: Meta<Range52Args> = {
  title: "App/Components/Range52View",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis '52-week range' renderer from src/components/market/Range52View.tsx: " +
          "one low→high rail per stock with the close marked as a dot, plus a 10-bin position " +
          "histogram. The proximity chips filter by distance from the 52-week high; ICICIBANK, " +
          "BHARTIARTL and SUNPHARMA in this fixture sit within 2% of it.",
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
type Story = StoryObj<Range52Args>;

const range52Story = (args: Range52Args) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="52-week range · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="All / within 2% / 5% / 10% · histogram of position"
        testId="story-range52-frame"
      >
        <ChartStage>
          <Range52View rows={args.scenario === "data" ? RANGE52_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => range52Story(args),
};

/** Rows with no usable high/low/close fall back to the explicit empty message. */
export const Empty: Story = {
  render: (args) => range52Story({ ...args, scenario: "empty" }),
};
