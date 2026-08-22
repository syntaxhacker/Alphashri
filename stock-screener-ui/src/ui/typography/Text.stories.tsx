import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "./Text";

const meta: Meta<typeof Text> = {
  title: "Design System/Typography/Text",
  component: Text,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Text>;

export const SizeVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Text key={size} size={size}>
          size=&quot;{size}&quot;
        </Text>
      ))}
    </div>
  ),
};

export const ColorVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24 }}>
      <Text c="teal">teal</Text>
      <Text c="red">red</Text>
      <Text c="blue">blue</Text>
      <Text c="dimmed">dimmed</Text>
    </div>
  ),
};

export const Truncated: Story = {
  render: () => (
    <Text truncate="end" style={{ maxWidth: 220 }}>
      This is a very long line of text that will be truncated with an ellipsis at the end.
    </Text>
  ),
};
