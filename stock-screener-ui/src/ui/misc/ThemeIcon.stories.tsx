import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Stack, Title } from "@/ui";
import { IconCheck, IconFlame } from "@tabler/icons-react";
import { ThemeIcon } from "./ThemeIcon";

const meta: Meta<typeof ThemeIcon> = {
  title: "Primitives/Misc/ThemeIcon",
  component: ThemeIcon,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Colored icon container with variant and gradient. Use for feature icons or empty-state illustrations. When not to use: for interactive icons use ActionIcon. Uses Mantine ThemeIcon with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof ThemeIcon>;

export const Default: Story = {
  args: {
    children: <IconFlame size={16} />,
  },
};

export const Variants: Story = {
  render: () => (
    <Group gap="md">
      <ThemeIcon variant="filled"><IconCheck size={16} /></ThemeIcon>
      <ThemeIcon variant="light" color="teal"><IconCheck size={16} /></ThemeIcon>
      <ThemeIcon variant="outline" color="blue"><IconCheck size={16} /></ThemeIcon>
      <ThemeIcon variant="default"><span style={{ fontSize: 12 }}>A</span></ThemeIcon>
    </Group>
  ),
};

export const Colors: Story = {
  render: () => (
    <Stack gap="xs">
      <Title order={6}>Light</Title>
      <Group gap="xs">
        <ThemeIcon variant="light" color="green"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="light" color="red"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="light" color="orange"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="light" color="violet"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="light" color="cyan"><IconCheck size={14} /></ThemeIcon>
      </Group>
      <Title order={6}>Filled</Title>
      <Group gap="xs">
        <ThemeIcon variant="filled" color="green"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="filled" color="red"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="filled" color="orange"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="filled" color="violet"><IconCheck size={14} /></ThemeIcon>
        <ThemeIcon variant="filled" color="cyan"><IconCheck size={14} /></ThemeIcon>
      </Group>
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Group gap="sm">
      <ThemeIcon size="xs"><IconCheck size={10} /></ThemeIcon>
      <ThemeIcon size="sm"><IconCheck size={12} /></ThemeIcon>
      <ThemeIcon size="md"><IconCheck size={14} /></ThemeIcon>
      <ThemeIcon size="lg"><IconCheck size={18} /></ThemeIcon>
      <ThemeIcon size="xl"><IconCheck size={22} /></ThemeIcon>
    </Group>
  ),
};

export const LetterChild: Story = {
  args: {
    size: "lg",
    radius: "xl",
    color: "grape",
    children: <strong style={{ fontSize: 16 }}>α</strong>,
  },
};
