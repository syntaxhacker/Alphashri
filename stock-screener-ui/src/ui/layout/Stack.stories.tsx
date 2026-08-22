import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack";

const meta: Meta<typeof Stack> = {
  title: "Primitives/Layout/Stack",
  component: Stack,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Stack>;

const items = ["One", "Two", "Three"].map((label) => (
  <div key={label} style={{ background: "var(--mantine-color-blue-light)", padding: 12, borderRadius: 6 }}>
    {label}
  </div>
));

export const DefaultGap: Story = {
  render: () => <Stack gap="md">{items}</Stack>,
};

export const TightGap: Story = {
  render: () => <Stack gap="xs">{items}</Stack>,
};

export const AlignEnd: Story = {
  render: () => (
    <Stack gap="sm" align="flex-end" w={300} p="xs" style={{ border: "1px dashed var(--mantine-color-default-border)" }}>
      {items}
    </Stack>
  ),
};
