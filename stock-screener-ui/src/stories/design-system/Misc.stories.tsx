import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Avatar, Box, CloseButton, Group, Stack, Text, ThemeIcon } from "@/ui";

const meta: Meta = { title: "Design System/Misc", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const Avatars: Story = {
  render: () =>
    solidStory(() => (
      <Group gap="md" align="center">
        <Avatar>AS</Avatar>
        <Avatar color="primary">N</Avatar>
        <Avatar color="success">P</Avatar>
        <Avatar color="error">L</Avatar>
        <Avatar size="xs">xs</Avatar>
        <Avatar size="sm">sm</Avatar>
        <Avatar size="lg">lg</Avatar>
        <Avatar size={56}>56</Avatar>
      </Group>
    )),
};

export const ThemeIcons: Story = {
  render: () =>
    solidStory(() => (
      <Group gap="md" align="center">
        <ThemeIcon color="primary">↻</ThemeIcon>
        <ThemeIcon color="success" variant="light">✓</ThemeIcon>
        <ThemeIcon color="warning" variant="outline">!</ThemeIcon>
        <ThemeIcon color="error" variant="filled">×</ThemeIcon>
        <ThemeIcon size="lg">Σ</ThemeIcon>
        <ThemeIcon size="xl" radius="xl">∞</ThemeIcon>
      </Group>
    )),
};

export const CloseButtons: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <Group gap="sm" align="center">
          <CloseButton />
          <CloseButton size="sm" />
          <CloseButton size="lg" />
          <CloseButton variant="filled" />
          <CloseButton variant="outline" />
          <CloseButton disabled />
        </Group>
        <Box p="sm" style={{ border: "1px solid var(--color-fin-border)", display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <Text size="sm">Panel header</Text>
          <CloseButton aria-label="Close panel" />
        </Box>
      </Stack>
    )),
};
