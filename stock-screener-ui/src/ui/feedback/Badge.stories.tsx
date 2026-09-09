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
        <Badge variant="light" color="primary">blue</Badge>
        <Badge variant="light" color="success">green</Badge>
        <Badge variant="light" color="error">red</Badge>
        <Badge variant="light" color="warning">orange</Badge>
        <Badge variant="light" color="info">teal</Badge>
        <Badge variant="light" color="secondary">violet</Badge>
        <Badge variant="light" color="secondary">gray</Badge>
      </Group>
      <Title order={6}>Filled</Title>
      <Group gap="xs">
        <Badge variant="filled" color="primary">blue</Badge>
        <Badge variant="filled" color="success">green</Badge>
        <Badge variant="filled" color="error">red</Badge>
        <Badge variant="filled" color="warning">orange</Badge>
        <Badge variant="filled" color="info">teal</Badge>
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
      <Badge leftSection={<span>↑</span>} color="success">
        +2.4%
      </Badge>
      <Badge rightSection={<span>×</span>} color="error">
        -1.1%
      </Badge>
    </Group>
  ),
};
