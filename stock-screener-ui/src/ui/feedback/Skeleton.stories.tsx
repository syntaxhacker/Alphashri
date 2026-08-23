import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Stack } from "@/ui";
import { Skeleton } from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Primitives/Feedback/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Placeholder shimmer for loading content. Use while fetching screener rows or chart data. When not to use: for short waits use Loader. Uses Mantine Skeleton with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {};

export const TextPlaceholder: Story = {
  args: {
    h: 12,
    w: "80%",
  },
};

export const Circle: Story = {
  args: {
    h: 56,
    w: 56,
    circle: true,
  },
};

export const Rectangular: Story = {
  args: {
    h: 120,
    w: 200,
    radius: "md",
  },
};

export const NoAnimation: Story = {
  args: {
    h: 40,
    w: 240,
    animate: false,
  },
};

export const CardComposition: Story = {
  render: () => (
    <Stack gap="sm" w={280}>
      <Skeleton h={140} radius="md" />
      <Group gap="sm">
        <Skeleton h={40} w={40} circle />
        <Stack gap={6} style={{ flex: 1 }}>
          <Skeleton h={12} w="70%" />
          <Skeleton h={8} w="45%" />
        </Stack>
      </Group>
      <Skeleton h={10} />
      <Skeleton h={10} w="85%" />
    </Stack>
  ),
};
