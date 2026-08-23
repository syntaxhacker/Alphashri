import type { Meta, StoryObj } from "@storybook/react-vite";
import { Center } from "./Center";

const meta: Meta<typeof Center> = {
  title: "Primitives/Layout/Center",
  component: Center,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Centering utility — flex centers children both axes. Use for empty states, loaders, or single-child centering. When not to use: for multi-item layouts use Group or Stack. Uses Mantine Center with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Center>;

export const BlockChild: Story = {
  render: () => (
    <Center style={{ minHeight: 150, background: "var(--mantine-color-blue-light)" }}>
      <div style={{ padding: 16, borderRadius: 8, background: "var(--mantine-color-blue-filled)", color: "white" }}>
        Block child, full-width centering
      </div>
    </Center>
  ),
};

export const InlineChild: Story = {
  render: () => (
    <div style={{ border: "1px dashed var(--mantine-color-default-border)" }}>
      <Center inline style={{ padding: 8 }}>
        <span>Inline child</span>
      </Center>
    </div>
  ),
};
