import type { Meta, StoryObj } from "@storybook/html-vite";
import { RelVolView } from "@/components/market/RelVolView";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { REL_VOL_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type RelVolArgs = { scenario: "data" | "empty" };

const meta: Meta<RelVolArgs> = {
  title: "App/Components/RelVolView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The Market → Vis 'Relative volume' renderer from src/components/market/RelVolView.tsx: " +
          "a lollipop chart ordered by today's volume against its trailing average, with a 2× " +
          "reference line. The track and dot use the diverging P&L ramp while the signed change " +
          "keeps semantic ink. Rows with no finite relative volume are excluded.",
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
type Story = StoryObj<RelVolArgs>;

const relVolStory = (args: RelVolArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Relative volume · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta="top 12 names · 2× / 3× chips · 0.7× to 4.2×"
        testId="story-relvol-frame"
      >
        <ChartStage>
          <RelVolView rows={args.scenario === "data" ? REL_VOL_ROWS : []} />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => relVolStory(args),
};

/** No finite relative-volume reading leaves no lollipops to draw. */
export const Empty: Story = {
  render: (args) => relVolStory({ ...args, scenario: "empty" }),
};
