import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip as MantineChip } from "@mantine/core";
import { Chip } from "./Chip";

const meta: Meta<typeof Chip> = {
  title: "Primitives/Inputs/Chip",
  component: Chip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Chip>;

export const Default: Story = {
  args: { children: "Default chip", defaultChecked: true },
};

export const Unchecked: Story = {
  args: { children: "Unchecked chip" },
};

export const Variants: Story = {
  render: () => (
    <MantineChip.Group multiple value={["filled"]}>
      <Chip variant="filled" value="filled">filled</Chip>
      <Chip variant="light" color="teal" value="light">light</Chip>
      <Chip variant="outline" color="blue" value="outline">outline</Chip>
    </MantineChip.Group>
  ),
};

export const Sizes: Story = {
  render: () => (
    <MantineChip.Group multiple value={["xs", "sm", "md"]}>
      <Chip size="xs" value="xs" defaultChecked>xs</Chip>
      <Chip size="sm" value="sm" defaultChecked>sm</Chip>
      <Chip size="md" value="md" defaultChecked>md</Chip>
      <Chip size="lg" value="lg">lg</Chip>
      <Chip size="xl" value="xl">xl</Chip>
    </MantineChip.Group>
  ),
};

export const Disabled: Story = {
  args: { children: "Disabled chip", disabled: true, defaultChecked: true },
};
