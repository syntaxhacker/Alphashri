import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "./Group";

const meta: Meta<typeof Group> = {
  title: "Primitives/Layout/Group",
  component: Group,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Group>;

const items = ["A", "B", "C", "D"].map((label) => (
  <div key={label} style={{ background: "var(--mantine-color-blue-light)", padding: 12, borderRadius: 6 }}>
    {label}
  </div>
));

export const SpaceBetween: Story = {
  render: () => (
    <Group justify="space-between" w={400} p="xs" style={{ border: "1px dashed var(--mantine-color-default-border)" }}>
      {items.slice(0, 2)}
    </Group>
  ),
};

export const WithWrap: Story = {
  render: () => (
    <Group gap="sm" wrap="wrap" w={220}>
      {items}
    </Group>
  ),
};

export const Grow: Story = {
  args: { grow: true, gap: "xs", w: 360, children: items },
};
