import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { CloseButton } from "./CloseButton";

const meta: Meta<typeof CloseButton> = {
  title: "Primitives/Misc/CloseButton",
  component: CloseButton,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Close/dismiss icon button. Use inside modals, alerts, or tags to dismiss. When not to use: for general actions use ActionIcon. Uses Mantine CloseButton with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof CloseButton>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <Group gap="sm">
      <CloseButton variant="subtle" />
      <CloseButton variant="light" />
      <CloseButton variant="outline" />
      <CloseButton variant="filled" />
      <CloseButton variant="transparent" />
    </Group>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Group gap="sm">
      <CloseButton size="xs" />
      <CloseButton size="sm" />
      <CloseButton size="md" />
      <CloseButton size="lg" />
      <CloseButton size="xl" />
    </Group>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const WithHandler: Story = {
  args: {
    onClick: () => {},
  },
};
