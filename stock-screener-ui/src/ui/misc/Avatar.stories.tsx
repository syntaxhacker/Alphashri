import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@/ui";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Primitives/Misc/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "User or symbol avatar with fallback. Use for user menus or watchlist symbols. When not to use: for generic icons use ThemeIcon. Uses MUI Avatar with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Default: Story = {
  args: {
    src: "https://picsum.photos/100",
    alt: "User avatar",
  },
};

export const FallbackInitials: Story = {
  args: {
    color: "info",
    children: "AS",
  },
};

export const BrokenSrcFallsBack: Story = {
  args: {
    src: "https://invalid.example/nope.png",
    alt: "Broken image",
    color: "secondary",
    children: "BK",
  },
};

export const Sizes: Story = {
  render: () => (
    <Group gap="sm">
      <Avatar src="https://picsum.photos/100" size="xs" />
      <Avatar src="https://picsum.photos/100" size="sm" />
      <Avatar src="https://picsum.photos/100" size="md" />
      <Avatar src="https://picsum.photos/100" size="lg" />
      <Avatar src="https://picsum.photos/100" size="xl" />
    </Group>
  ),
};

export const RadiusVariants: Story = {
  render: () => (
    <Group gap="sm">
      <Avatar size="lg" radius="xs">R1</Avatar>
      <Avatar size="lg" radius="md" color="primary">R2</Avatar>
      <Avatar size="lg" radius="xl" color="warning">R3</Avatar>
      <Avatar size="lg" radius={0} color="error">SQ</Avatar>
    </Group>
  ),
};
