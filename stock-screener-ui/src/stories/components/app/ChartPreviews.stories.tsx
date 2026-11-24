import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import type { ChartPreviewData, PreviewCandle } from "@/api/chartPreview";
import { ExpandedPanel } from "@/components/common/preview/ExpandedPanel";
import { HoverPreview } from "@/components/common/preview/HoverPreview";
import { RETRY_MESSAGE } from "@/components/common/preview/request";
import type { ChartInstanceBox } from "@/components/common/preview/types";
import { Button, Group, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const candle = (
  time: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): PreviewCandle => ({
  time: `2026-11-20T${time}`,
  date: "2026-11-20",
  time_str: time,
  open,
  high,
  low,
  close,
  volume,
});

const CANDLES: PreviewCandle[] = [
  candle("09:15", 23412.4, 23448.7, 23402.1, 23438.5, 182400),
  candle("09:30", 23438.5, 23466.2, 23421.8, 23458.9, 146700),
  candle("09:45", 23458.9, 23472.4, 23440.3, 23462.5, 121300),
  candle("10:00", 23462.5, 23481.6, 23449.2, 23474.8, 138900),
  candle("10:15", 23474.8, 23492.3, 23461.7, 23484.2, 165200),
  candle("10:30", 23484.2, 23495.1, 23470.4, 23479.6, 119800),
  candle("10:45", 23479.6, 23488.0, 23452.9, 23460.3, 154600),
  candle("11:00", 23460.3, 23469.5, 23443.8, 23455.1, 132700),
];

const CHART_DATA: ChartPreviewData = {
  symbol: "NIFTY",
  candles: CANDLES,
  orb_zones: [
    {
      date: "2026-11-20",
      date_raw: "2026-11-20",
      or_high: 23462.5,
      or_low: 23402.1,
      or_end_time: "2026-11-20T10:00",
    },
  ],
  pivot_levels: [
    {
      date: "2026-11-20",
      date_raw: "2026-11-20",
      pp: 23442.6,
      r1: 23482.7,
      s1: 23402.5,
      r2: 23522.8,
      s2: 23362.4,
    },
  ],
  high_52w: 24120.5,
  timeframe: 15,
  or_minutes: 45,
  total_candles: CANDLES.length,
};

type PreviewArgs = {
  state: "data" | "loading" | "error" | "empty";
};

const meta: Meta<PreviewArgs> = {
  title: "Design System/Components/App/ChartPreviews",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The two chart preview surfaces from src/components/common/preview/: a pointer-following " +
          "hover card and a larger dialog with timeframe, opening-range and pivot controls. Both " +
          "take the same frozen preview payload, so loading, transport failure and successful " +
          "empty responses can be told apart. Charts are drawn with the lazy ECharts loader.",
      },
    },
  },
  args: { state: "data" },
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["data", "loading", "error", "empty"],
      description: "Which caller-owned result state the preview renders.",
    },
  },
};
export default meta;
type Story = StoryObj<PreviewArgs>;

const stateOf = (args: PreviewArgs) => ({
  data: args.state === "data" ? CHART_DATA : null,
  loading: args.state === "loading",
  error: args.state === "error" ? RETRY_MESSAGE : null,
});

const hoverStory = (args: PreviewArgs, x: number, caption: string) =>
  solidStory(() => {
    const state = stateOf(args);
    const chartBox: ChartInstanceBox = { current: null };
    return (
      <DemoStack>
        <DemoPanel
          title="Hover preview · NIFTY"
          detail={caption}
          meta="15m · 20 Nov 2026 session"
          testId="story-hover-preview-frame"
        >
          <Specimen label="Pointer card" detail="The card follows the pointer and never intercepts clicks.">
            <HoverStage>{caption}</HoverStage>
          </Specimen>
        </DemoPanel>
        <HoverPreview
          symbol="NIFTY"
          x={x}
          y={72}
          data={state.data}
          loading={state.loading}
          error={state.error}
          chartBox={chartBox}
        />
      </DemoStack>
    );
  });

const HoverStage = (props: { children: string }) => (
  <Stack gap="xs" style={{ "max-width": "520px" }}>
    <Text size="sm" fw={600}>{props.children}</Text>
    <Text size="xs" c="dimmed">
      Hover cards are shown at the pointer position below; the card is non-interactive by design.
    </Text>
  </Stack>
);

const expandedStory = (args: PreviewArgs) =>
  solidStory(() => {
    const [visible, setVisible] = createSignal(true);
    const [retried, setRetried] = createSignal(false);
    const [timeframe, setTimeframe] = createSignal(15);
    const [orMinutes, setOrMinutes] = createSignal(45);
    const state = () => stateOf(retried() && args.state === "error" ? { ...args, state: "data" as const } : args);
    const chartBox: ChartInstanceBox = { current: null };
    return (
      <DemoStack>
        <DemoPanel
          title="Expanded preview · NIFTY"
          detail="Timeframe and opening-range selectors, pivots and the 52-week high."
          meta="20 Nov 2026 session"
          testId="story-expanded-preview-frame"
        >
          <Group gap="sm">
            <Button size="sm" onClick={() => setVisible(true)}>Reopen expanded chart</Button>
            <Text size="xs" c="dimmed">Close the dialog to return to this panel.</Text>
          </Group>
        </DemoPanel>
        <Show when={visible()}>
          <ExpandedPanel
            symbol="NIFTY"
            data={state().data}
            loading={state().loading}
            error={state().error}
            timeframe={timeframe()}
            orMinutes={orMinutes()}
            chartBox={chartBox}
            onTimeframeChange={(value) => value && setTimeframe(Number(value))}
            onOrMinutesChange={(value) => value && setOrMinutes(Number(value))}
            onClose={() => setVisible(false)}
            onOpenFull={(symbol) => window.open(`/chart/${encodeURIComponent(symbol)}`, "_blank")}
            onRetry={() => setRetried(true)}
          />
        </Show>
      </DemoStack>
    );
  });

export const HoverWithData: Story = {
  render: (args) => hoverStory(args, 64, "Frozen NIFTY candles with the opening range drawn."),
};

export const HoverLoading: Story = {
  render: (args) => hoverStory({ ...args, state: "loading" }, 64, "Waiting for the preview endpoint."),
};

export const HoverRetryHint: Story = {
  render: (args) => hoverStory({ ...args, state: "error" }, 64, "A failed request suggests hovering away and back."),
};

/** A huge pointer position proves the card is clamped inside the viewport. */
export const HoverNearViewportEdge: Story = {
  render: (args) => hoverStory(args, 4000, "Near the viewport edge the card stays fully on screen."),
};

export const ExpandedWithData: Story = {
  render: (args) => expandedStory(args),
};

export const ExpandedLoading: Story = {
  render: (args) => expandedStory({ ...args, state: "loading" }),
};

export const ExpandedRetry: Story = {
  render: (args) => expandedStory({ ...args, state: "error" }),
};

export const ExpandedNoData: Story = {
  render: (args) => expandedStory({ ...args, state: "empty" }),
};
