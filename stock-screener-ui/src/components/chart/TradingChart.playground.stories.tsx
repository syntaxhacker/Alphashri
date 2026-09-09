import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { TradingChart } from "./TradingChart";
import { MOCK_PAPER_ORB, MOCK_PAPER_PIVOT, MOCK_PAPER_52W, MOCK_PAPER_EMA } from "@/stories/fixtures";
import { normalizePaper } from "@/utils/chart/normalizePaper";

type Preset = "orb" | "pivot" | "52w" | "ema" | "all";

const PRESET_MAP: Record<Preset, any> = {
  orb: MOCK_PAPER_ORB,
  pivot: MOCK_PAPER_PIVOT,
  "52w": MOCK_PAPER_52W,
  ema: MOCK_PAPER_EMA,
  all: {
    ...MOCK_PAPER_ORB,
    pivot_levels: (MOCK_PAPER_PIVOT as any).pivot_levels,
    week52_levels: (MOCK_PAPER_52W as any).week52_levels,
    ema_series: (MOCK_PAPER_EMA as any).ema_series,
  },
};

type PlaygroundArgs = {
  preset: Preset;
  showOrb: boolean;
  showPivots: boolean;
  show52w: boolean;
  showEma: boolean;
};

const meta: Meta<PlaygroundArgs> = {
  title: "Composites/Charts/TradingChart",
  tags: ["autodocs"],
  parameters: { layout: "padded", docs: { description: { component: "TradingChart playground — the single ECharts wrapper. Toggle overlays live via Controls; the 5 decoupled stories in Templates/Chart + Patterns/Charts/BacktestChart exist for Chromatic (one line family per snapshot)." } } },
  argTypes: {
    preset: { control: "select", options: ["orb", "pivot", "52w", "ema", "all"] },
    showOrb: { control: "boolean" },
    showPivots: { control: "boolean" },
    show52w: { control: "boolean" },
    showEma: { control: "boolean" },
  },
  args: {
    preset: "all",
    showOrb: true,
    showPivots: true,
    show52w: true,
    showEma: true,
  },
  render: (args: PlaygroundArgs) => {
    const base = PRESET_MAP[args.preset] ?? PRESET_MAP.all;
    const input = normalizePaper(base, false, null, false, args.showOrb, args.showPivots, args.show52w, args.showEma);
    return (
      <Box sx={{ height: 380, width: "100%", minWidth: 600 }}>
        <TradingChart input={input} />
      </Box>
    );
  },
};
export default meta;
type Story = StoryObj<PlaygroundArgs>;

export const Playground: Story = {
  name: "Playground — toggle any combination",
};
