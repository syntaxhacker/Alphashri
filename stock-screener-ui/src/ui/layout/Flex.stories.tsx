import type { Meta, StoryObj } from "@storybook/react-vite";
import { Flex } from "./Flex";

const meta: Meta<typeof Flex> = {
  title: "Primitives/Layout/Flex",
  component: Flex,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Flexbox layout primitive with full flex props. Use when direction/wrap/gap control is needed beyond Group/Stack. When not to use: simple row use Group, column use Stack. Uses the local @/ui Flex with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Flex>;

const items = ["A", "B", "C"].map((label) => (
  <div key={label} style={{ background: "#80b5ff", padding: 12, "border-radius": 6 }}>
    {label}
  </div>
));

export const RowWithGap: Story = {
  render: () => (
    <Flex direction="row" justify="flex-start" gap="md">
      {items}
    </Flex>
  ),
};

export const Column: Story = {
  render: () => (
    <Flex direction="column" gap="sm" w={200}>
      {items}
    </Flex>
  ),
};

export const SpaceBetween: Story = {
  render: () => (
    <Flex direction="row" justify="space-between" align="center" w={400} p="xs">
      {items}
    </Flex>
  ),
};
