import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "./Group";

const meta: Meta<typeof Group> = {
  title: "Primitives/Layout/Group",
  component: Group,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Horizontal flex group with gap and alignment. Use for button rows, header bars, inline controls. When not to use: for vertical stacking use Stack. Uses MUI Group with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Group>;

const items = ["A", "B", "C", "D"].map((label) => (
  <div key={label} style={{ background: "var(--mui-palette-primary-light)", padding: 12, borderRadius: 6 }}>
    {label}
  </div>
));

export const SpaceBetween: Story = {
  render: () => (
    <Group justify="space-between" w={400} p="xs">
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
