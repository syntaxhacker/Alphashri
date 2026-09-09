import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, Box, Card, Group, Stack, Text, Title } from "@/ui";
import { IconChartBar, IconChartLine, IconRobot, IconSettings } from "@tabler/icons-react";
import { AppShell } from "./AppShell";
import { NavLink } from "./NavLink";

const meta: Meta<typeof AppShell> = {
  title: "Primitives/Navigation/AppShell",
  component: AppShell,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", docs: { description: { component: "Application shell — fixed header + collapsible navbar + scrollable main. Mirrors AppLayout in the app. Navbar uses NavLink primitives, not raw Text." } } },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const FullShell: Story = {
  render: () => (
    <AppShell header={{ height: 50 }} navbar={{ width: 200, breakpoint: "sm" }} padding="md" h="100vh">
      <AppShell.Header>
        <Group h="100%" px="sm" justify="space-between">
          <Text fw={700} size="lg">
            🚀 Alphashri
          </Text>
          {/* MarketTicker placeholder - real one needs WS */}
          <Box flex={1} style={{ maxWidth: 360 }}>
            <Text size="xs" c="dimmed" ta="center" style={{ borderRadius: 6, padding: "4px 8px" }}>
              Market Ticker
            </Text>
          </Box>
          <Badge variant="light" color="info" size="sm">
            Market Open
          </Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow>
          <Stack gap={2}>
            <NavLink label="Screener" icon={<IconChartLine size={16} />} active />
            <NavLink label="Backtest" icon={<IconChartLine size={16} />} />
            <NavLink label="Paper Trading" icon={<IconChartLine size={16} />} description="3 open" />
            <NavLink label="Bots" icon={<IconRobot size={16} />} />
            <NavLink label="Strategies" icon={<IconChartBar size={16} />} />
            <NavLink label="Settings" icon={<IconSettings size={16} />} />
          </Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Text size="xs" c="dimmed" px="xs">
            v2.0.0
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack gap="md">
          <Title order={3}>Dashboard</Title>
          <Group gap="md">
            <Card shadow="xs" padding="md" style={{ flex: 1 }}>
              <Text size="xs" c="dimmed">
                Positions
              </Text>
              <Text fw={700} size="xl">
                3 open
              </Text>
            </Card>
            <Card shadow="xs" padding="md" style={{ flex: 1 }}>
              <Text size="xs" c="dimmed">
                Unrealized P&L
              </Text>
              <Text fw={700} size="xl" c="info">
                +₹1,240
              </Text>
            </Card>
            <Card shadow="xs" padding="md" style={{ flex: 1 }}>
              <Text size="xs" c="dimmed">
                Market Status
              </Text>
              <Text fw={600}>Open · NSE</Text>
            </Card>
          </Group>
          <Text size="sm" c="dimmed">
            Main scrolls independently; header and navbar stay fixed. Resize the viewport to see the sm breakpoint collapse.
          </Text>
        </Stack>
      </AppShell.Main>
    </AppShell>
  ),
};

export const CollapsedNavbar: Story = {
  render: () => (
    <AppShell header={{ height: 50 }} navbar={{ width: 80, breakpoint: "sm" }} padding="md" h="100vh">
      <AppShell.Header>
        <Group h="100%" px="sm">
          <Text fw={700}>🚀</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <Stack gap={4} align="center">
          <IconChartLine size={20} />
          <IconChartLine size={20} />
          <IconRobot size={20} />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Text size="sm" c="dimmed">
          Collapsed width 80 — icons only. Toggle via the sidebar button in the real app.
        </Text>
      </AppShell.Main>
    </AppShell>
  ),
};
