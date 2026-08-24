import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Group, Stack, Text, Title } from "@/ui";
import { MemoryRouter } from "react-router-dom";
import { PreviewChartProvider, usePreviewChart } from "./PreviewChartProvider";
import { ClickableSymbol } from "./ClickableSymbol";

function mockEcharts() {
  if (!(window as unknown as Record<string, unknown>).echarts) {
    (window as unknown as Record<string, unknown>).echarts = {
      init: () => ({ setOption: () => {}, dispose: () => {}, resize: () => {} }),
    };
  }
}
mockEcharts();

function HoverTrigger({ symbol }: { symbol: string }) {
  return <ClickableSymbol symbol={symbol} showPreview />;
}

function ExpandTrigger({ symbol }: { symbol: string }) {
  const { toggleExpandedChart } = usePreviewChart();
  return <ClickableSymbol symbol={symbol} onClick={() => toggleExpandedChart(symbol)} />;
}

const meta: Meta = {
  title: "Composites/Overlays/PreviewChart",
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          'Chart overlay system — `PreviewChartProvider` supplies hover previews (320×200, tf=15/days=1, 45m OR) and click-to-expand panels (650×480, tf=15/days=5) via portal for any `ClickableSymbol`. Wrap app or story decorators with the provider. When not: for static inline charts render ECharts directly without this provider.',
      },
    },
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PreviewChartProvider>
          <Story />
        </PreviewChartProvider>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const HoverPreview: Story = {
  render: () => (
    <Stack gap="sm" align="center" p="md">
      <Title order={6}>Hover RELIANCE to show 320×200 preview</Title>
      <Text size="xs" c="dimmed">HoverPreview fetches tf=15, days=1, OR 45m. Mock window.echarts if needed.</Text>
      <Group>
        <HoverTrigger symbol="RELIANCE" />
        <HoverTrigger symbol="TCS" />
        <HoverTrigger symbol="INFY" />
      </Group>
    </Stack>
  ),
};

export const ExpandedPanel: Story = {
  render: () => (
    <Stack gap="sm" align="center" p="md">
      <Title order={6}>Click to open 650×480 ExpandedPanel</Title>
      <Text size="xs" c="dimmed">ExpandedPanel fetches tf=15, days=5, with timeframe/OR selectors.</Text>
      <Group>
        <ExpandTrigger symbol="RELIANCE" />
        <ExpandTrigger symbol="HDFCBANK" />
      </Group>
      <Text size="xs" c="dimmed">Panel is centered via Portal (fixed, z 10000).</Text>
    </Stack>
  ),
};

export const NoData: Story = {
  render: () => (
    <Stack gap="sm" align="center" p="md">
      <Title order={6}>NoData empty state</Title>
      <Text size="xs" c="dimmed">When candles is empty, HoverPreview shows “No data” and ExpandedPanel shows “No data available”.</Text>
      <Box p="sm" style={{ borderRadius: 8 }}>
        <Text size="xs">Hover or click an unknown symbol (e.g. UNKNOWN123) to hit empty branch.</Text>
        <Group mt="xs">
          <HoverTrigger symbol="UNKNOWN123" />
          <ExpandTrigger symbol="UNKNOWN123" />
        </Group>
      </Box>
    </Stack>
  ),
};
