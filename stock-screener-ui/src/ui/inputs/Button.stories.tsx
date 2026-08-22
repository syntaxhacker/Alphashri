import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Design System/UI/Inputs/Button",
  component: Button,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: "Default button" },
};

export const Variants: Story = {
  render: () => (
    <Group gap="md">
      <Button variant="filled">filled</Button>
      <Button variant="light">light</Button>
      <Button variant="subtle">subtle</Button>
      <Button variant="default">default</Button>
    </Group>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Group gap="md">
      <Button size="xs">xs</Button>
      <Button size="sm">sm</Button>
      <Button size="md">md</Button>
      <Button size="lg">lg</Button>
      <Button size="xl">xl</Button>
    </Group>
  ),
};

export const Disabled: Story = {
  args: { children: "Disabled", disabled: true },
};

export const Loading: Story = {
  render: () => (
    <Group gap="md">
      <Button leftSection={<span>⏳</span>}>Saving…</Button>
      <Button loading>Loading…</Button>
    </Group>
  ),
};
