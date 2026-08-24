import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text, Title } from "@/ui";
import { Timeline, TimelineItem } from "./Timeline";

const meta: Meta<typeof Timeline> = {
  title: "Primitives/Data Display/Timeline",
  component: Timeline,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Vertical timeline with bullets. Use for trade history, audit logs, or step progress. When not to use: for tables use DataTable. Uses MUI Timeline with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Timeline>;

export const Default: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Default timeline</Title>
      <Timeline active={1} bulletSize={20} lineWidth={2}>
        <TimelineItem title="Market open" color="success">
          <Text size="sm" c="dimmed">09:15 IST · prewarm complete</Text>
        </TimelineItem>
        <TimelineItem title="Signals scanned" color="primary">
          <Text size="sm" c="dimmed">12 candidates · 2 passed filters</Text>
        </TimelineItem>
        <TimelineItem title="Trade closed" color="warning">
          <Text size="sm" c="dimmed">TP hit at 14:02 · P&L +1.5%</Text>
        </TimelineItem>
      </Timeline>
    </Stack>
  ),
};

export const CustomBullets: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Custom bullets + line variants</Title>
      <Timeline active={2}>
        <TimelineItem title="Buy filled" color="info" lineVariant="solid">
          <Text size="sm" c="dimmed">RELIANCE @ ₹2,410.50</Text>
        </TimelineItem>
        <TimelineItem title="Stop trailed" color="secondary" lineVariant="dashed">
          <Text size="sm" c="dimmed">SL moved to breakeven</Text>
        </TimelineItem>
        <TimelineItem
          title="Exit"
          color="error"
          lineVariant="dotted"
          bullet={<Text size="xs" fw={700}>!</Text>}
        >
          <Text size="sm" c="dimmed">Stop loss hit (PnL: -0.40%)</Text>
        </TimelineItem>
      </Timeline>
    </Stack>
  ),
};

export const AlignRight: Story = {
  render: () => (
    <Timeline active={-1} align="right">
      <TimelineItem title="Entry logged" color="primary">Right-aligned content</TimelineItem>
      <TimelineItem title="Exit logged" color="secondary">Supports reverseActive too</TimelineItem>
    </Timeline>
  ),
};
