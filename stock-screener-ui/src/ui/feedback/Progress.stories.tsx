import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { Progress } from "./Progress";

const meta: Meta<typeof Progress> = {
  title: "Primitives/Feedback/Progress",
  component: Progress,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Bar showing completion or level. Use for upload, scan, or quota progress. When not to use: for indeterminate loading use Loader. Uses MUI Progress with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Progress>;

export const Default: Story = {
  args: {
    value: 66,
  },
};

export const Values: Story = {
  render: () => (
    <Stack gap="sm">
      <Progress value={0} />
      <Progress value={50} />
      <Progress value={100} />
    </Stack>
  ),
};

export const Colors: Story = {
  render: () => (
    <Stack gap="sm">
      <Progress value={75} color="blue" />
      <Progress value={60} color="green" />
      <Progress value={40} color="orange" />
      <Progress value={20} color="red" />
    </Stack>
  ),
};

export const Striped: Story = {
  args: {
    value: 55,
    striped: true,
  },
};

export const StripedAnimated: Story = {
  args: {
    value: 55,
    striped: true,
    animated: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap="sm">
      <Progress value={70} size="xs" />
      <Progress value={70} size="sm" />
      <Progress value={70} size="md" />
      <Progress value={70} size="lg" />
    </Stack>
  ),
};

export const WithLabel: Story = {
  args: {
    value: 62,
    label: "62%",
    size: "lg",
  },
};
