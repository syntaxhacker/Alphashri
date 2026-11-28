import type { Meta, StoryObj } from "@storybook/html-vite";
import { Show, type JSX } from "solid-js";
import { Box, Group, SimpleGrid, Stack, Text } from "@/ui";
import { Sparkline } from "@/components/common/Sparkline";
import { MiniLineChart, type MiniSeries } from "@/components/common/charts/MiniLineChart";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "../app/StoryFrame";
import { SNAPSHOT_LABEL } from "./market.fixtures";

/** Index paths in points, frozen for the session; no feed, no animation. */
const NIFTY_RISING = [23412.4, 23438.5, 23429.1, 23462.5, 23474.8, 23481.6, 23508.2, 23544.7];
const BANKNIFTY_FALLING = [50182.5, 50146.2, 50158.8, 50094.4, 50072.1, 50088.6, 50026.3, 49984.7];
const FINNIFTY_FLAT = [21842.1, 21846.5, 21839.8, 21844.2, 21841.6, 21847.3, 21843.9, 21845.2];
const SHORT_PATH = [1824.4, 1828.2, 1831.6];
const GAPPED_PATH = [1428.6, null, 1436.2, undefined, 1442.8, 1439.4];

const LABELS = ["09:15", "10:00", "10:45", "11:30", "12:15", "13:00", "13:45", "14:30", "15:10"];
const CALL_OI: MiniSeries = {
  name: "NIFTY 24300 CE OI",
  points: [124, 186, 242, 318, 486, 742, 1180, 1642, 2104],
  color: palette.VIZ_CATEGORICAL[0]!,
  area: true,
};
const PUT_OI: MiniSeries = {
  name: "NIFTY 24300 PE OI",
  points: [186, 162, 228, 196, 284, 386, 352, 428, 496],
  color: palette.VIZ_CATEGORICAL[1]!,
};

type PrimitivesArgs = { state: "paths" | "short" | "profile" | "empty" };

const meta: Meta<PrimitivesArgs> = {
  title: "App/Components/ChartPrimitives",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The two dependency-free SVG primitives used inside the market visuals: Sparkline from " +
          "src/components/common/Sparkline.tsx and MiniLineChart from " +
          "src/components/common/charts/MiniLineChart.tsx. Both are fed frozen NSE index paths and " +
          "option open-interest profiles here; fewer than two finite points renders no sparkline and " +
          "an all-null series renders the MiniLineChart empty message.",
      },
    },
  },
  args: { state: "paths" },
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["paths", "short", "profile", "empty"],
      description: "Which frozen specimen is shown.",
    },
  },
};
export default meta;
type Story = StoryObj<PrimitivesArgs>;

const QuoteCard = (props: {
  name: string;
  value: string;
  tone?: string;
  children: JSX.Element;
}) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    <Stack gap="xs" align="flex-start">
      <Text size="xs" fw={700} c="secondary">{props.name}</Text>
      <Text size="sm" fw={700} c={props.tone ?? "default"}>{props.value}</Text>
      {props.children}
    </Stack>
  </Box>
);

const spark = (values: Array<number | null | undefined>, color: string, testId: string) => (
  <Sparkline values={values} width={160} height={36} color={color} testId={testId} />
);

const primitivesStory = (args: PrimitivesArgs) =>
  solidStory(() => (
    <DemoStack width={880}>
      <Show when={args.state === "paths" || args.state === "short"}>
        <DemoPanel
          title="Sparklines · frozen NSE paths"
          detail={SNAPSHOT_LABEL}
          meta={args.state === "short" ? "3-point, gapped and 1-point series" : "rising · falling · flat"}
          testId="story-chart-primitives-sparks-frame"
        >
          <Specimen label="Quote-card paths">
            <SimpleGrid cols={3} spacing="sm">
              <Show when={args.state === "paths"}>
                <QuoteCard name="NIFTY · rising" value="23,544.70 · +0.56%" tone="success">
                  {spark(NIFTY_RISING, palette.VIZ_UP, "story-viz-spark-up")}
                </QuoteCard>
                <QuoteCard name="BANKNIFTY · falling" value="49,984.70 · -0.39%" tone="error">
                  {spark(BANKNIFTY_FALLING, palette.VIZ_DOWN, "story-viz-spark-down")}
                </QuoteCard>
                <QuoteCard name="FINNIFTY · flat" value="21,845.20 · +0.01%" tone="secondary">
                  {spark(FINNIFTY_FLAT, palette.VIZ_MUTED, "story-viz-spark-flat")}
                </QuoteCard>
              </Show>
              <Show when={args.state === "short"}>
                <QuoteCard name="SUNPHARMA · 3 points" value="1,824.40 → 1,831.60">
                  {spark(SHORT_PATH, palette.VIZ_UP, "story-viz-spark-short")}
                </QuoteCard>
                <QuoteCard name="RELIANCE · gapped feed" value="4 finite points">
                  {spark(GAPPED_PATH, palette.VIZ_CATEGORICAL[3]!, "story-viz-spark-gapped")}
                </QuoteCard>
                <QuoteCard name="Single point" value="renders nothing">
                  {spark([1428.6], palette.VIZ_MUTED, "story-viz-spark-single")}
                </QuoteCard>
              </Show>
            </SimpleGrid>
          </Specimen>
        </DemoPanel>
      </Show>

      <Show when={args.state === "profile" || args.state === "empty"}>
        <DemoPanel
          title="Mini line chart · NIFTY 24300 option OI"
          detail="frozen open-interest profile · 09:15 → 15:10 IST"
          meta="nulls break the line · all-null renders the empty message"
          testId="story-chart-primitives-profile-frame"
        >
          <Stack gap="sm">
            <Group gap="md" wrap="wrap">
              {[CALL_OI, PUT_OI].map((series) => (
                <Group gap="xs" align="center">
                  <Box style={{ width: "10px", height: "10px", "border-radius": "2px", "background-color": series.color }} />
                  <Text size="xs" c="secondary">{series.name}</Text>
                </Group>
              ))}
            </Group>
            <MiniLineChart
              series={args.state === "empty" ? [{ ...PUT_OI, points: [null, null, null] }] : [CALL_OI, PUT_OI]}
              labels={LABELS}
              height={180}
              zeroLine
              markers={args.state === "empty" ? [] : [{ index: 4, label: "12:15 flip", color: palette.VIZ_CATEGORICAL[2]! }]}
              formatValue={(v) => `${v.toFixed(0)} lots`}
              emptyMessage="No open-interest points for this window"
              testId="story-viz-mini-profile"
            />
          </Stack>
        </DemoPanel>
      </Show>
    </DemoStack>
  ));

export const SparkPaths: Story = {
  render: (args) => primitivesStory({ ...args, state: "paths" }),
};

/** Three points and gapped/null feeds are drawable; a single point is not. */
export const ShortAndSparse: Story = {
  render: (args) => primitivesStory({ ...args, state: "short" }),
};

export const OiProfile: Story = {
  render: (args) => primitivesStory({ ...args, state: "profile" }),
};

export const EmptyProfile: Story = {
  render: (args) => primitivesStory({ ...args, state: "empty" }),
};
