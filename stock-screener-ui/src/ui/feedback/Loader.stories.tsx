import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { Loader } from "./Loader";

const meta: Meta<typeof Loader> = {
  title: "Primitives/Feedback/Loader",
  component: Loader,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Loader>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <Group gap="lg">
      <Loader size="xs" />
      <Loader size="sm" />
      <Loader size="md" />
      <Loader size="lg" />
      <Loader size="xl" />
    </Group>
  ),
};

export const Types: Story = {
  render: () => (
    <Group gap="lg">
      <Loader type="oval" />
      <Loader type="bars" />
      <Loader type="dots" />
    </Group>
  ),
};

export const Colored: Story = {
  render: () => (
    <Group gap="lg">
      <Loader color="blue" />
      <Loader color="green" />
      <Loader color="red" />
      <Loader color="orange" size="sm" />
    </Group>
  ),
};

export const CustomSizeNumber: Story = {
  args: {
    size: 42,
    color: "teal",
  },
};
