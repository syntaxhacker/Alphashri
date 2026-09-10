import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@/ui";
import { RingProgress } from "./RingProgress";

const meta: Meta<typeof RingProgress> = {
  title: "Primitives/Feedback/RingProgress",
  component: RingProgress,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Circular progress with sections. Use for portfolio allocation, completion rings, or P&L gauges. When not to use: for linear progress use Progress. Uses MUI RingProgress with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof RingProgress>;

export const Default: Story = {
  args: {
    value: 68,
  },
};

export const WithLabel: Story = {
  args: {
    value: 68,
    label: "68%",
  },
};

export const Colored: Story = {
  render: () => (
    <Group gap="md">
      <RingProgress value={80} color="success" label="80%" />
      <RingProgress value={45} color="warning" label="45%" />
      <RingProgress value={15} color="error" label="15%" />
    </Group>
  ),
};

export const Sections: Story = {
  args: {
    sections: [
      { value: 40, color: "info", tooltip: "Longs" },
      { value: 25, color: "warning", tooltip: "Shorts" },
      { value: 15, color: "error", tooltip: "Losses" },
    ],
  },
};

export const SizesAndThickness: Story = {
  render: () => (
    <Group gap="md">
      <RingProgress value={60} size={80} thickness={6} />
      <RingProgress value={60} size={120} thickness={10} />
      <RingProgress value={60} size={160} thickness={14} roundCaps />
    </Group>
  ),
};
