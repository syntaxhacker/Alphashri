import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Stack, Title } from "@/ui";
import { Badge } from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Feedback/Badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Compact status/value label. Use for counts, statuses, or categories. When not to use: for alerts use Alert. Uses MUI Badge with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: "Default badge",
  },
};

export const Variants: Story = {
  render: () => (
    <Group gap="xs">
      <Badge variant="filled">filled</Badge>
      <Badge variant="light">light</Badge>
      <Badge variant="outline">outline</Badge>
      <Badge variant="subtle">subtle</Badge>
    </Group>
  ),
};

export const Colors: Story = {
  render: () => (
    <Stack gap="xs">
      <Title order={6}>Light</Title>
      <Group gap="xs">
        <Badge variant="light" color="blue">blue</Badge>
        <Badge variant="light" color="green">green</Badge>
        <Badge variant="light" color="red">red</Badge>
        <Badge variant="light" color="orange">orange</Badge>
        <Badge variant="light" color="teal">teal</Badge>
        <Badge variant="light" color="violet">violet</Badge>
        <Badge variant="light" color="gray">gray</Badge>
      </Group>
      <Title order={6}>Filled</Title>
      <Group gap="xs">
        <Badge variant="filled" color="blue">blue</Badge>
        <Badge variant="filled" color="green">green</Badge>
        <Badge variant="filled" color="red">red</Badge>
        <Badge variant="filled" color="orange">orange</Badge>
        <Badge variant="filled" color="teal">teal</Badge>
      </Group>
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Group gap="xs">
      <Badge size="xs">xs</Badge>
      <Badge size="sm">sm</Badge>
      <Badge size="md">md</Badge>
      <Badge size="lg">lg</Badge>
      <Badge size="xl">xl</Badge>
    </Group>
  ),
};

export const WithSections: Story = {
  render: () => (
    <Group gap="xs">
      <Badge leftSection={<span>↑</span>} color="green">
        +2.4%
      </Badge>
      <Badge rightSection={<span>×</span>} color="red">
        -1.1%
      </Badge>
    </Group>
  ),
};
