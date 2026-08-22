import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Design System/UI/Inputs/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: { label: "Include closed trades", defaultChecked: true },
};

export const Unchecked: Story = {
  args: { label: "Unchecked" },
};

export const Indeterminate: Story = {
  render: () => (
    <Stack gap="xs">
      <Checkbox label="Select all strategies" indeterminate checked />
      <Checkbox label="ORB Best" checked />
      <Checkbox label="SR Breakout" checked />
      <Checkbox label="52W Chaser" />
    </Stack>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Stack gap="xs">
      <Checkbox label="Disabled unchecked" disabled />
      <Checkbox label="Disabled checked" checked disabled />
    </Stack>
  ),
};

export const WithDescription: Story = {
  args: {
    label: "Enable shorts",
    description: "Allow short entries when signal fires",
    color: "teal",
  },
};
