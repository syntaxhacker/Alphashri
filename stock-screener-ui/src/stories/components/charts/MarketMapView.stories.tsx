import type { Meta, StoryObj } from "@storybook/html-vite";
import { MarketMapView } from "@/components/market/MarketMapView";
import {
  MARKET_SIZE_METRIC_VALUES,
  type MarketSizeMetric,
} from "@/components/market/marketTreemap";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { MARKET_ROWS, SNAPSHOT_LABEL } from "./market.fixtures";

type HeatmapArgs = { scenario: "data" | "empty"; sizeBy: MarketSizeMetric };

const meta: Meta<HeatmapArgs> = {
  title: "App/Components/MarketMapView",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The flat stock heatmap from src/components/market/MarketMapView.tsx, the first Vis " +
          "renderer. Tile area comes from Size by and the fill from the same metric unless a " +
          "separate Colour by is supplied by the host. Tiles are an ECharts canvas, so the story " +
          "gives it a bounded flex parent. An empty filter shows the canvas fallback.",
      },
    },
  },
  args: { scenario: "data", sizeBy: "change_pct" },
  argTypes: {
    scenario: {
      control: "inline-radio",
      options: ["data", "empty"],
      description: "Frozen NSE snapshot or the filtered-to-nothing state.",
    },
    sizeBy: {
      control: "select",
      options: MARKET_SIZE_METRIC_VALUES,
      description: "Metric driving tile area and colour.",
    },
  },
};
export default meta;
type Story = StoryObj<HeatmapArgs>;

const heatmapStory = (args: HeatmapArgs) =>
  solidStory(() => (
    <DemoStack width={1024}>
      <DemoPanel
        title="Market heatmap · NSE snapshot"
        detail={SNAPSHOT_LABEL}
        meta={`size by ${args.sizeBy} · 18 liquid names`}
        testId="story-market-map-frame"
      >
        <ChartStage>
          <MarketMapView
            rows={args.scenario === "data" ? MARKET_ROWS : []}
            sizeBy={args.sizeBy}
          />
        </ChartStage>
      </DemoPanel>
    </DemoStack>
  ));

export const Playground: Story = {
  render: (args) => heatmapStory(args),
};

export const SizedByMarketCap: Story = {
  render: (args) => heatmapStory({ ...args, sizeBy: "market_cap" }),
};

/** No rows means no drawable tiles, so the canvas is never mounted. */
export const Empty: Story = {
  render: (args) => heatmapStory({ ...args, scenario: "empty" }),
};
