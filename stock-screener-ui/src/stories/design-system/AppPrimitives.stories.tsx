import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Group, Stack, Text } from "@/ui";
import { KeyValue } from "@/components/common/KeyValue";
import { ExitReasonBadge, SideBadge, StatusBadge } from "@/components/common/BadgeComponents";
import { PnlText } from "@/components/common/PnlText";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";

const meta: Meta = { title: "Design System/App primitives", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const KeyValueRows: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "320px" }}>
        <KeyValue label="Spot" value="23,450.85" hint="+18.42 (0.08%)" tone="success" mono testId="spot" />
        <KeyValue label="PCR (OI)" value="1.12" dense />
        <KeyValue label="Max pain" value="23,400" align="left" />
        <KeyValue label="Updated" value="12:03:15 IST" tone="dimmed" />
      </Box>
    )),
};

export const MarketBadges: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <Group gap="sm" align="center">
          <SideBadge side="BUY" />
          <SideBadge side="SELL" />
          <ExitReasonBadge reason="TP" />
          <ExitReasonBadge reason="SL" />
          <ExitReasonBadge reason="TRAILING_STOP" />
          <ExitReasonBadge reason="52W Target" />
          <StatusBadge running />
          <StatusBadge running={false} statusUnknown />
        </Group>
        <Group gap="lg" align="center">
          <PnlText value={1240.5} />
          <PnlText value={-318.25} />
          <PnlText value={0} />
        </Group>
      </Stack>
    )),
};

export const States: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "620px" }}>
        <EmptyState title="No rows for this filter" description="Widen the strike range or switch expiry." />
        <ErrorAlert title="Feed unavailable" message="The options tape returned 503." withRetry onRetry={() => {}} />
        <InlineLoader message="Loading option chain" />
        <Text size="xs" c="dimmed">Shared app primitives keep the same spacing, type scale and semantic tones as the design system.</Text>
      </Stack>
    )),
};
