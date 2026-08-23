import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Primitives/Inputs/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Toggle switch for boolean settings. Use for on/off settings like bot enable. When not to use: for multi-option choice use SegmentedControl or Checkbox. Uses Mantine Switch with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  args: { label: "Auto-trade", defaultChecked: true },
};

export const OffAndOn: Story = {
  render: () => (
    <Stack gap="sm">
      <Switch label="Off" />
      <Switch label="On" defaultChecked />
    </Stack>
  ),
};

export const WithLabels: Story = {
  args: {
    label: "Notifications",
    description: "Show alerts on the desktop",
    onLabel: "ON",
    offLabel: "OFF",
    defaultChecked: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap="xs">
      <Switch size="xs" label="xs" defaultChecked />
      <Switch size="sm" label="sm" defaultChecked />
      <Switch size="md" label="md" defaultChecked />
      <Switch size="lg" label="lg" defaultChecked />
      <Switch size="xl" label="xl" defaultChecked />
    </Stack>
  ),
};

export const Disabled: Story = {
  args: { label: "Disabled", disabled: true },
};
