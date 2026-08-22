import type { Meta, StoryObj } from "@storybook/react-vite";
import { Center } from "./Center";

const meta: Meta<typeof Center> = {
  title: "Design System/Layout/Center",
  component: Center,
  tags: ["autodocs"],
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
