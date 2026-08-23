import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Group, Title } from "@/ui";
import { PnlText, PnlBadge } from "./PnlText";

const meta: Meta<typeof PnlText> = {
  title: "Composites/PnL",
  component: PnlText,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          'Color-coded P&L primitives — `PnlText` (inline text, green/red/dimmed) and `PnlBadge` (filled badge). Use wherever a numeric profit/loss or percent must convey polarity at a glance (tables, stat tiles, trade rows). When not: for non-P&L status use `SideBadge`/`ExitReasonBadge` instead.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PnlText>;

export const TextVariants: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>PnlText</Title>
      <Group gap="md">
        <PnlText value={5.42} />
        <PnlText value={0} />
        <PnlText value={-3.18} />
      </Group>
      <Title order={5}>PnlBadge</Title>
      <Group gap="md">
        <PnlBadge value={5.42} />
        <PnlBadge value={0} />
        <PnlBadge value={-3.18} />
      </Group>
    </Stack>
  ),
};

export const Positive: Story = {
  args: { value: 5.42 },
};

export const Negative: Story = {
  args: { value: -3.18 },
};

export const Zero: Story = {
  args: { value: 0 },
};
