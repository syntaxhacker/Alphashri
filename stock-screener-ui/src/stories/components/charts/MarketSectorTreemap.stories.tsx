import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { Text } from "@/ui";
import { MarketSectorTreemap } from "@/components/market/MarketSectorTreemap";
import {
  MARKET_SIZE_METRIC_VALUES,
  type MarketSizeMetric,
} from "@/components/market/marketTreemap";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "../app/StoryFrame";
import { ChartStage } from "./ChartStage";
import { MARKET_ROWS, SNAPSHOT_LABEL, TREEMAP_ROWS } from "./market.fixtures";

type TreemapArgs = {
  universe: "sectors" | "all" | "empty";
  sizeBy: MarketSizeMetric;
};

const meta: Meta<TreemapArgs> = {
  title: "App/Components/MarketSectorTreemap",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The nested sector → stock treemap from src/components/market/MarketSectorTreemap.tsx. " +
          "Sector block area is the sum of member sizes; a stock tile's label, area and colour all " +
          "come from Size by. Tiles are ECharts canvases, so a bounded flex parent is required. " +
          "A filter that leaves no drawable tile falls back to the empty message.",
      },
    },
  },
  args: { universe: "sectors", sizeBy: "change_pct" },
  argTypes: {
    universe: {
      control: "inline-radio",
      options: ["sectors", "all", "empty"],
      description: "Which frozen snapshot slice feeds the treemap.",
    },
    sizeBy: {
      control: "select",
      options: MARKET_SIZE_METRIC_VALUES,
      description: "Metric driving tile area, label and colour.",
    },
  },
};
export default meta;
type Story = StoryObj<TreemapArgs>;

const rowsFor = (args: TreemapArgs) =>
  args.universe === "empty" ? [] : args.universe === "all" ? MARKET_ROWS : TREEMAP_ROWS;

const treemapStory = (args: TreemapArgs) =>
  solidStory(() => {
    const [picked, setPicked] = createSignal<string | null>(null);
    return (
      <DemoStack width={1024}>
        <DemoPanel
          title="Sector treemap · NSE snapshot"
          detail={SNAPSHOT_LABEL}
          meta={`size by ${args.sizeBy} · click a leaf for its symbol`}
          testId="story-sector-treemap-frame"
        >
          <Show when={picked()}>
            <Text size="xs" c="dimmed">Selected symbol: {picked()}</Text>
          </Show>
          <ChartStage>
            <MarketSectorTreemap
              rows={rowsFor(args)}
              sizeBy={args.sizeBy}
              onSymbolClick={setPicked}
            />
          </ChartStage>
        </DemoPanel>
      </DemoStack>
    );
  });

export const Playground: Story = {
  render: (args) => treemapStory(args),
};

export const SectorAndStockTiles: Story = {
  render: (args) => treemapStory({ ...args, universe: "sectors", sizeBy: "change_pct" }),
};

export const SizedByMarketCap: Story = {
  render: (args) => treemapStory({ ...args, universe: "all", sizeBy: "market_cap" }),
};

/** No rows means no drawable sector parents — the canvas is never mounted. */
export const Empty: Story = {
  render: (args) => treemapStory({ ...args, universe: "empty" }),
};
