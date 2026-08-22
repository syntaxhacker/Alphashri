import type { Meta, StoryObj } from "@storybook/react-vite";
import { CorrelationHeatmap } from "./CorrelationHeatmap";

const symbols = ["RELIANCE", "TCS", "INFY", "HDFCBANK"];

const matrix4x4: number[][] = [
  [1.0, 0.42, 0.31, -0.18],
  [0.42, 1.0, 0.76, -0.05],
  [0.31, 0.76, 1.0, 0.12],
  [-0.18, -0.05, 0.12, 1.0],
];

const meta: Meta<typeof CorrelationHeatmap> = {
  title: "Composites/CorrelationHeatmap",
  component: CorrelationHeatmap,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CorrelationHeatmap>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <CorrelationHeatmap matrix={matrix4x4} symbols={symbols} />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={{ maxWidth: 640, minHeight: 300 }}>
      <CorrelationHeatmap matrix={matrix4x4} symbols={symbols} isLoading />
    </div>
  ),
};

export const NoData: Story = {
  render: () => (
    <div style={{ maxWidth: 640, minHeight: 300 }}>
      <CorrelationHeatmap matrix={[]} symbols={[]} />
    </div>
  ),
};
