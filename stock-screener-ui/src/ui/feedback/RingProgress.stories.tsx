import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { RingProgress } from "./RingProgress";

const meta: Meta<typeof RingProgress> = {
  title: "Primitives/Feedback/RingProgress",
  component: RingProgress,
  tags: ["autodocs"],
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
      <RingProgress value={80} color="green" label="80%" />
      <RingProgress value={45} color="orange" label="45%" />
      <RingProgress value={15} color="red" label="15%" />
    </Group>
  ),
};

export const Sections: Story = {
  args: {
    sections: [
      { value: 40, color: "teal", tooltip: "Longs" },
      { value: 25, color: "orange", tooltip: "Shorts" },
      { value: 15, color: "red", tooltip: "Losses" },
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
