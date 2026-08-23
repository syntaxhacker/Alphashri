import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { SegmentedControl } from "./SegmentedControl";

const meta: Meta<typeof SegmentedControl> = {
  title: "Primitives/Inputs/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Segmented switch for 2-5 exclusive options. Use for timeframe, mode, or view toggles. When not to use: for >5 options use Select. Uses Mantine SegmentedControl with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

const data = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
];

export const Default: Story = {
  args: { data, defaultValue: "1d" },
};

export const ControlledColors: Story = {
  render: () => (
    <SegmentedControl
      data={data}
      defaultValue="1w"
      color="teal"
      aria-label="Chart timeframe"
    />
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack gap="sm">
      <SegmentedControl data={data} size="xs" aria-label="xs" />
      <SegmentedControl data={data} size="sm" aria-label="sm" />
      <SegmentedControl data={data} size="md" aria-label="md" />
      <SegmentedControl data={data} size="lg" aria-label="lg" />
    </Stack>
  ),
};

export const FullWidth: Story = {
  args: { data, fullWidth: true, defaultValue: "1m", withItemsBorders: true },
};
