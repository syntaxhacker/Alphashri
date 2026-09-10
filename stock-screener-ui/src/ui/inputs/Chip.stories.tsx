import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "./Chip";

const meta: Meta<typeof Chip> = {
  title: "Primitives/Inputs/Chip",
  component: Chip,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Selectable chip/pill. Use for filter toggles or tag selection. When not to use: for primary actions use Button. Uses MUI Chip with theme tokens (no hardcoded colors)." } } },
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
    <Chip.Group multiple value={["filled"]}>
      <Chip variant="filled" value="filled">filled</Chip>
      <Chip variant="light" color="info" value="light">light</Chip>
      <Chip variant="outline" color="primary" value="outline">outline</Chip>
    </Chip.Group>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Chip.Group multiple value={["xs", "sm", "md"]}>
      <Chip size="xs" value="xs" defaultChecked>xs</Chip>
      <Chip size="sm" value="sm" defaultChecked>sm</Chip>
      <Chip size="md" value="md" defaultChecked>md</Chip>
      <Chip size="lg" value="lg">lg</Chip>
      <Chip size="xl" value="xl">xl</Chip>
    </Chip.Group>
  ),
};

export const Disabled: Story = {
  args: { children: "Disabled chip", disabled: true, defaultChecked: true },
};
