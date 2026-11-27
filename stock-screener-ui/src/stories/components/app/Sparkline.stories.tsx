import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, SimpleGrid, Stack, Text } from "@/ui";
import { Sparkline } from "@/components/common/Sparkline";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen intraday paths · 2026-11-20 09:15→15:10 IST";
const UP_PATH = [3, 4, 3.5, 6, 5, 7, 8, 8.5];
const DOWN_PATH = [8, 7.5, 7, 7.2, 6, 5, 4, 3.2];
const FLAT_PATH = [5, 5.1, 4.9, 5, 5.2, 5, 5.1, 5];

type SparklineArgs = {
  width: number;
  height: number;
  color: string;
  animate: boolean;
  responsive: boolean;
};

const meta: Meta<SparklineArgs> = {
  title: "App/Components/Sparkline",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A tiny dependency-free SVG trend line from src/components/common/Sparkline.tsx. " +
          "Non-finite entries are filtered before plotting; fewer than two finite points renders " +
          "nothing. `responsive` drops the width/height attributes so the parent viewBox controls " +
          "the size. Colours come from palette exports or CSS variables, never literal hex.",
      },
    },
  },
  args: {
    width: 120,
    height: 32,
    color: "var(--color-fin-primary)",
    animate: false,
    responsive: false,
  },
  argTypes: {
    width: { control: { type: "range", min: 40, max: 240, step: 4 }, description: "SVG coordinate width." },
    height: { control: { type: "range", min: 12, max: 64, step: 2 }, description: "SVG coordinate height." },
    color: { control: "text", description: "Stroke colour — CSS variable or palette export." },
    animate: { control: "boolean", description: "One-time draw-in animation on mount." },
    responsive: { control: "boolean", description: "Omit width/height attributes; parent CSS sizes it." },
  },
};
export default meta;
type Story = StoryObj<SparklineArgs>;

/** A quote card gives the tiny SVG a readable label and scale. */
const QuoteCard = (props: { name: string; value: string; tone?: string; children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    <Stack gap="xs" align="flex-start">
      <Text size="xs" fw={700} c="secondary">{props.name}</Text>
      <Text size="sm" fw={700} c={props.tone ?? "default"}>{props.value}</Text>
      {props.children}
    </Stack>
  </Box>
);

/** Controls are bound to the real Sparkline props. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Sparkline · playground"
          detail={FIXTURE_LABEL}
          meta={`${args.width}×${args.height} · ${args.responsive ? "responsive" : "fixed"}`}
          testId="story-spark-playground-frame"
        >
          <QuoteCard name="NIFTY · intraday path" value="23,450.85 · +0.08%" tone="success">
            <Sparkline
              values={UP_PATH}
              width={args.width}
              height={args.height}
              color={args.color}
              animate={args.animate}
              responsive={args.responsive}
              testId="story-spark-playground"
            />
          </QuoteCard>
        </DemoPanel>
      </DemoStack>
    )),
};

export const Directions: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Sparkline · semantic stroke colours"
          detail={FIXTURE_LABEL}
          meta="up · down · flat · animated"
          testId="story-spark-directions-frame"
        >
          <Specimen label="Frozen index paths">
            <SimpleGrid cols={2} spacing="sm">
              <QuoteCard name="NIFTY" value="+8.5 pts" tone="success">
                <Sparkline values={UP_PATH} color="var(--color-fin-positive)" testId="story-spark-up" />
              </QuoteCard>
              <QuoteCard name="BANKNIFTY" value="-4.8 pts" tone="error">
                <Sparkline values={DOWN_PATH} color="var(--color-fin-negative)" testId="story-spark-down" />
              </QuoteCard>
              <QuoteCard name="MIDCPNIFTY" value="flat" tone="secondary">
                <Sparkline values={FLAT_PATH} color="var(--color-fin-text-muted)" testId="story-spark-flat" />
              </QuoteCard>
              <QuoteCard name="FINNIFTY" value="draw-in on mount" tone="warning">
                <Sparkline values={UP_PATH} color="var(--color-fin-warning)" animate testId="story-spark-animated" />
              </QuoteCard>
            </SimpleGrid>
          </Specimen>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Nulls and non-finite numbers are dropped before scaling. */
export const SparseValues: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Sparkline · sparse values"
          detail={`${FIXTURE_LABEL} · nulls filtered, too-short series omitted`}
          meta="3 edge cases"
          testId="story-spark-sparse-frame"
        >
          <SimpleGrid cols={3} spacing="sm">
            <QuoteCard name="Gapped feed" value="4 finite points">
              <Sparkline values={[4, null, 6, undefined, 8, 7]} color="var(--color-fin-info)" testId="story-spark-nulls" />
            </QuoteCard>
            <QuoteCard name="Single point" value="renders nothing">
              <Sparkline values={[5]} color="var(--color-fin-primary)" testId="story-spark-single" />
            </QuoteCard>
            <QuoteCard name="Empty series" value="renders nothing">
              <Sparkline values={[]} color="var(--color-fin-primary)" testId="story-spark-empty" />
            </QuoteCard>
          </SimpleGrid>
        </DemoPanel>
      </DemoStack>
    )),
};

export const Responsive: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Sparkline · responsive viewBox"
          detail={`${FIXTURE_LABEL} · viewBox-driven sizing`}
          meta="2 stacked paths"
          testId="story-spark-responsive-frame"
        >
          <Stack gap="sm">
            <Box style={{ width: "520px", padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
              <Text size="xs" fw={700} c="secondary">NIFTY · rising</Text>
              <Sparkline values={UP_PATH} responsive width={200} height={40} color="var(--color-fin-primary)" />
            </Box>
            <Box style={{ width: "520px", padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
              <Text size="xs" fw={700} c="secondary">BANKNIFTY · falling</Text>
              <Sparkline values={DOWN_PATH} responsive width={200} height={40} color="var(--color-fin-negative)" />
            </Box>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
