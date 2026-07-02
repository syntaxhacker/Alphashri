import type { Meta, StoryObj } from "@storybook/react";
import { ActionIcon, Badge, Button, Group, Stack, Text } from "@/ui";
import { IconRefresh, IconSearch, IconSparkles } from "@tabler/icons-react";
import { CompactPage, CompactPanel, CompactStat, CompactStatGrid } from "./compact";

const meta: Meta<typeof CompactPanel> = {
  title: "Design System/Common/Compact",
  component: CompactPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof CompactPanel>;

export const Panel: Story = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <CompactPanel
        title="Compact Panel"
        description="Shared surface for cards, empty states, and dense content blocks."
        action={
          <Button size="xs" variant="light" leftSection={<IconSparkles size={12} />}>
            Action
          </Button>
        }
      >
        <Stack gap="xs">
          <Text size="sm">
            This replaces repeated `Card` and `Paper` shells in compact dashboard views.
          </Text>
          <Group gap="xs">
            <Badge variant="light" color="teal">
              Reusable
            </Badge>
            <Badge variant="light" color="gray">
              Theme-aware
            </Badge>
          </Group>
        </Stack>
      </CompactPanel>
    </div>
  ),
};

export const StatGrid: Story = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 960 }}>
      <CompactStatGrid>
        <CompactStat label="Net P&L" value="₹42,180" tone="green" hint="+8.2% today" />
        <CompactStat label="Win Rate" value="61.4%" tone="blue.6" hint="Last 30 trades" />
        <CompactStat label="Open Positions" value="4" tone="orange.6" hint="2 active strategies" />
        <CompactStat label="Drawdown" value="-3.1%" tone="red.6" hint="Within limit" />
      </CompactStatGrid>
    </div>
  ),
};

export const PageShell: Story = {
  render: () => (
    <div style={{ height: 520, padding: 16 }}>
      <CompactPage
        title="Compact Page Shell"
        description="Use this for dense pages that still need a clear heading row."
        actions={
          <Group gap="xs">
            <ActionIcon variant="light" aria-label="refresh">
              <IconRefresh size={14} />
            </ActionIcon>
            <Button size="xs" variant="light" leftSection={<IconSearch size={12} />}>
              Search
            </Button>
          </Group>
        }
      >
        <CompactPanel
          title="Nested Surface"
          description="A page can stack common surfaces without repeating styling."
        >
          <Text size="sm" c="dimmed">
            Keep the outer page layout and the inner content surfaces separate.
          </Text>
        </CompactPanel>
      </CompactPage>
    </div>
  ),
};
