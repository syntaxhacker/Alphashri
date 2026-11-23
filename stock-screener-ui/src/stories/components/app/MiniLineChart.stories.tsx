import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, Group, Stack, Text } from "@/ui";
import { MiniLineChart, type MiniSeries } from "@/components/common/charts/MiniLineChart";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack } from "./StoryFrame";

const FIXTURE_LABEL = "frozen OI/profile series · 2026-11-20 09:15→15:10 IST";
const LABELS = ["09:15", "10:00", "10:45", "11:30", "12:15", "13:00", "13:45", "14:30", "15:10"];

const CALL_SERIES: MiniSeries = { name: "Call OI", points: [12, 18, 16, 28, 34, 30, 42, 50, 58], color: palette.INFO, area: true };
const PUT_SERIES: MiniSeries = { name: "Put OI", points: [20, 19, 24, 22, 30, 38, 35, 44, 48], color: palette.WARNING };
const NET_SERIES: MiniSeries = { name: "Net gamma", points: [-8, -1, -8, 6, 4, -8, 7, 6, 10], color: palette.POSITIVE, axis: 0 };

type MiniChartArgs = {
  height: number;
  zeroLine: boolean;
  scale: "linear" | "sqrt";
};

const meta: Meta<MiniChartArgs> = {
  title: "Design System/Components/App/MiniLineChart",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A lightweight SVG chart from src/components/common/charts/MiniLineChart.tsx used for " +
          "static monitoring visuals. Null points break the line; `sqrt` compresses long-tailed " +
          "profiles while preserving sign; the hover readout uses the raw value. Series colours " +
          "come from palette exports, never literal hex.",
      },
    },
  },
  args: { height: 180, zeroLine: true, scale: "linear" },
  argTypes: {
    height: { control: { type: "range", min: 80, max: 320, step: 20 }, description: "SVG plot height." },
    zeroLine: { control: "boolean", description: "Draw a dashed zero reference on axis 0." },
    scale: { control: "inline-radio", options: ["linear", "sqrt"], description: "Y-axis compression." },
  },
};
export default meta;
type Story = StoryObj<MiniChartArgs>;

const ChartStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Palette-derived swatches keep the legend honest without baking a colour. */
const Legend = (props: { items: ReadonlyArray<{ label: string; color: string }> }) => (
  <Group gap="md" align="center" wrap="wrap">
    {props.items.map((item) => (
      <Group gap="xs" align="center">
        <Box style={{ width: "10px", height: "10px", "border-radius": "2px", "background-color": item.color }} />
        <Text size="xs" c="secondary">{item.label}</Text>
      </Group>
    ))}
  </Group>
);

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Mini line chart · playground"
          detail={FIXTURE_LABEL}
          meta={`${args.height}px · ${args.scale} scale`}
          testId="story-mini-playground-frame"
        >
          <Stack gap="sm">
            <Legend items={[{ label: "Call OI", color: palette.INFO }, { label: "Put OI", color: palette.WARNING }]} />
            <ChartStrip>
              <MiniLineChart
                series={[CALL_SERIES, PUT_SERIES]}
                labels={LABELS}
                height={args.height}
                zeroLine={args.zeroLine}
                scale={args.scale}
                formatValue={(v) => v.toFixed(0)}
                testId="story-mini-playground"
              />
            </ChartStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const ZeroLineAndMarkers: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Mini line chart · zero line and markers"
          detail={`${FIXTURE_LABEL} · signed net series with a zero reference`}
          meta="2 markers · flip at 11:30, wall at 13:45"
          testId="story-mini-markers-frame"
        >
          <Stack gap="sm">
            <Legend items={[{ label: "Net gamma", color: palette.POSITIVE }]} />
            <ChartStrip>
              <MiniLineChart
                series={[NET_SERIES]}
                labels={LABELS}
                height={160}
                zeroLine
                markers={[
                  { index: 3, label: "flip", color: palette.PRIMARY },
                  { index: 6, label: "wall", color: palette.WARNING },
                ]}
                formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}`}
                testId="story-mini-markers"
              />
            </ChartStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const SqrtScale: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Mini line chart · sqrt scale"
          detail={`${FIXTURE_LABEL} · long-tailed profile, sqrt compression`}
          meta="2 → 3,200 OI"
          testId="story-mini-sqrt-frame"
        >
          <Stack gap="sm">
            <Legend items={[{ label: "Call OI (area)", color: palette.INFO }]} />
            <ChartStrip>
              <MiniLineChart
                series={[{ ...CALL_SERIES, points: [2, 6, 14, 40, 120, 420, 900, 1500, 3200], area: true }]}
                labels={LABELS}
                height={160}
                scale="sqrt"
                formatValue={(v) => v.toFixed(0)}
                testId="story-mini-sqrt"
              />
            </ChartStrip>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};

export const GapsAndEmpty: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Mini line chart · gaps and empty"
          detail={`${FIXTURE_LABEL} · nulls break the line; all-null renders the empty message`}
          meta="1 sparse feed · 1 no feed"
          testId="story-mini-gaps-frame"
        >
          <Stack gap="md">
            <Stack gap="xs">
              <Legend items={[{ label: "Sparse feed", color: palette.INFO }]} />
              <ChartStrip>
                <MiniLineChart
                  series={[{ name: "Sparse feed", points: [10, null, 18, 16, null, 28, 30, null, 42], color: palette.INFO }]}
                  labels={LABELS}
                  height={140}
                  testId="story-mini-sparse"
                />
              </ChartStrip>
            </Stack>
            <Stack gap="xs">
              <Legend items={[{ label: "No feed", color: palette.TEXT_MUTED }]} />
              <ChartStrip>
                <MiniLineChart
                  series={[{ name: "No feed", points: [null, null, null], color: palette.TEXT_MUTED }]}
                  labels={LABELS}
                  height={100}
                  emptyMessage="No frozen points for this window"
                  testId="story-mini-empty"
                />
              </ChartStrip>
            </Stack>
          </Stack>
        </DemoPanel>
      </DemoStack>
    )),
};
