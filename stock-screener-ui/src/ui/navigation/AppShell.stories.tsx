import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, Group, Stack, Text } from "@mantine/core";
import { AppShell } from "./AppShell";

const meta: Meta<typeof AppShell> = {
  title: "Design System/Navigation/AppShell",
  component: AppShell,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

const navLinks = [
  { label: "Dashboard", active: false },
  { label: "Paper Trading", active: true },
  { label: "Screener", active: false },
  { label: "Strategies", active: false },
];

export const FullShell: Story = {
  render: () => (
    <AppShell header={{ height: 56 }} navbar={{ width: 220 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={700} size="lg">
            Alphashri
          </Text>
          <Badge variant="light" color="teal" size="sm">
            Market Open
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section>
          <Stack gap={0}>
            {navLinks.map((link) => (
              <Text
                key={link.label}
                px="md"
                py={8}
                size="sm"
                fw={link.active ? 700 : 400}
                c={link.active ? "var(--mantine-color-blue-filled)" : undefined}
                style={{ borderRadius: 6 }}
              >
                {link.label}
              </Text>
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Text px="md" size="xs" c="dimmed">
            v2.0.0
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Stack gap="sm">
          <Text fw={600}>Main Content</Text>
          <Text size="sm" c="dimmed">
            The app shell composes a fixed header, a navbar with sections, and a scrollable main area.
            Use the toolbar to toggle light/dark and resize the viewport to see responsive behavior.
          </Text>
        </Stack>
      </AppShell.Main>
    </AppShell>
  ),
};

export const AltLayout: Story = {
  render: () => (
    <AppShell header={{ height: 56 }} navbar={{ width: 200 }} padding="md" layout="alt">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Text fw={700}>Alt Layout</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <Stack gap={0}>
          <Text px="md" py={8} size="sm">Item A</Text>
          <Text px="md" py={8} size="sm">Item B</Text>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Text size="sm" c="dimmed">
          With layout=&quot;alt&quot; the header spans only beside the navbar instead of the full width.
        </Text>
      </AppShell.Main>
    </AppShell>
  ),
};
