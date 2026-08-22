import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { ActionIcon } from "./ActionIcon";

const meta: Meta<typeof ActionIcon> = {
  title: "Design System/UI/Inputs/ActionIcon",
  component: ActionIcon,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ActionIcon>;

export const Default: Story = {
  args: {
    variant: "default",
    children: "⚙",
  },
};

export const Variants: Story = {
  render: () => (
    <Group gap="md">
      <ActionIcon variant="subtle">✎</ActionIcon>
      <ActionIcon variant="light" color="blue">✎</ActionIcon>
      <ActionIcon variant="filled" color="blue">✎</ActionIcon>
    </Group>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Group gap="md">
      <ActionIcon size="xs">＋</ActionIcon>
      <ActionIcon size="sm">＋</ActionIcon>
      <ActionIcon size="md">＋</ActionIcon>
      <ActionIcon size="lg">＋</ActionIcon>
      <ActionIcon size="xl">＋</ActionIcon>
    </Group>
  ),
};

export const Disabled: Story = {
  args: { variant: "light", disabled: true, children: "✎" },
};

export const Loading: Story = {
  args: { variant: "filled", loading: true },
};
