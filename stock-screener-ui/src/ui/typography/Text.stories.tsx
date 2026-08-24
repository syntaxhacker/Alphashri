import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Group, Title } from "@/ui";
import { Text } from "./Text";

const meta: Meta<typeof Text> = {
  title: "Primitives/Typography/Text",
  component: Text,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Base typography — size, weight, color, truncation. Use for any body copy or labels. When not to use: for headings use Title. Uses MUI Text with theme tokens (no hardcoded colors)." } } },
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

// c="dimmed" is the most common pattern in the app (280+ usages) — secondary/meta text
export const Dimmed: Story = {
  render: () => (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        xs dimmed — table meta, timestamps, helper text
      </Text>
      <Text size="sm" c="dimmed">
        sm dimmed — card descriptions, secondary labels
      </Text>
    </Stack>
  ),
};

// fw 500-800 dominate the app (270+ usages)
export const Weights: Story = {
  render: () => (
    <Stack gap={4}>
      <Text size="sm" fw={400}>fw=400 normal</Text>
      <Text size="sm" fw={500}>fw=500 medium</Text>
      <Text size="sm" fw={600}>fw=600 semibold (most used)</Text>
      <Text size="sm" fw={700}>fw=700 bold</Text>
      <Text size="sm" fw={800}>fw=800 extrabold</Text>
    </Stack>
  ),
};

// The canonical app idiom: small + dimmed label next to weighted value
export const LabelValuePattern: Story = {
  render: () => (
    <Group gap="xs">
      <Text size="xs" c="dimmed">Entry:</Text>
      <Text size="sm" fw={600}>₹2,450.50</Text>
      <Text size="xs" c="dimmed">P&L:</Text>
      <Text size="sm" fw={600} c="green">+₹500.00</Text>
    </Group>
  ),
};

export const Alignment: Story = {
  render: () => (
    <Stack w={320} gap={4}>
      <Text ta="left">ta=&quot;left&quot;</Text>
      <Text ta="center">ta=&quot;center&quot;</Text>
      <Text ta="right">ta=&quot;right&quot; (table numerics)</Text>
    </Stack>
  ),
};

export const ColorVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <Text c="teal">teal</Text>
      <Text c="green">green</Text>
      <Text c="red">red</Text>
      <Text c="orange">orange</Text>
      <Text c="blue">blue</Text>
      <Text c="gray">gray</Text>
      <Text c="dimmed">dimmed</Text>
      <Text c="success">success</Text>
      <Text c="danger">danger</Text>
      <Text c="warning">warning</Text>
    </div>
  ),
};

// MUI shade syntax (color.N) used for fine-tuned contrast in tables/badges
export const ShadeColors: Story = {
  render: () => (
    <Stack gap={4}>
      <Text c="green.6">c=&quot;green.6&quot; — positive PnL</Text>
      <Text c="red.6">c=&quot;red.6&quot; — negative PnL</Text>
      <Text c="blue.7">c=&quot;blue.7&quot; — links/info</Text>
      <Text c="orange.7">c=&quot;orange.7&quot; — warnings</Text>
      <Text c="gray.6">c=&quot;gray.6&quot;</Text>
    </Stack>
  ),
};

export const Truncation: Story = {
  render: () => (
    <Stack gap="md">
      <div>
        <Title order={6}>truncate (single line)</Title>
        <Text truncate="end" style={{ maxWidth: 220 }}>
          This is a very long line of text that will be truncated with an ellipsis at the end.
        </Text>
      </div>
      <div>
        <Title order={6}>lineClamp (multi-line)</Title>
        <Text lineClamp={2} style={{ maxWidth: 300 }}>
          News headlines and article summaries often span multiple lines. lineClamp limits them
          to a fixed number of rows while keeping the full text accessible. This paragraph is
          long enough to be clamped at two lines in this container width.
        </Text>
      </div>
    </Stack>
  ),
};

export const InlineSpan: Story = {
  render: () => (
    <Text size="sm">
      Rendered as a <Text span fw={600}>span (inline)</Text> instead of a block-level paragraph.
    </Text>
  ),
};
