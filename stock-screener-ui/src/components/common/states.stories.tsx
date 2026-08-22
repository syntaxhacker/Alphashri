import type { Meta, StoryObj } from "@storybook/react";
import { Stack, Title } from "@/ui";
import { InlineLoader, EmptyState, ErrorAlert, EmptyCompact } from "./states";

const meta: Meta<typeof InlineLoader> = {
  title: "Design System/Common/States",
  component: InlineLoader,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof InlineLoader>;

export const AllStates: Story = {
  render: () => (
    <Stack gap="md" p="md">
      <div>
        <Title order={5}>InlineLoader</Title>
        <InlineLoader />
      </div>
      <div>
        <Title order={5}>EmptyState</Title>
        <EmptyState title="No data available" description="Try a different filter or date range." />
      </div>
      <div>
        <Title order={5}>EmptyState (emoji)</Title>
        <EmptyState emoji="📊" title="No trades today" description="Come back during market hours." />
      </div>
      <div>
        <Title order={5}>EmptyCompact</Title>
        <EmptyCompact title="Empty Panel" description="This panel has no content yet." />
      </div>
      <div>
        <Title order={5}>ErrorAlert</Title>
        <ErrorAlert message="Failed to fetch data from the server." />
      </div>
      <div>
        <Title order={5}>ErrorAlert with retry</Title>
        <ErrorAlert
          message="Connection lost."
          title="Network Error"
          withRetry
          onRetry={() => alert("Retry clicked")}
        />
      </div>
    </Stack>
  ),
};

export const LoaderSmall: Story = {
  args: { size: "sm" },
};

export const LoaderLarge: Story = {
  args: { size: "lg" },
};

export const EmptyDefault: Story = {
  render: () => <EmptyState title="No data" description="Nothing to show here yet." />,
};

export const EmptyWithEmoji: Story = {
  render: () => <EmptyState emoji="🔍" title="No results" description="Try adjusting your filters." />,
};

export const EmptyCompactStandalone: Story = {
  render: () => (
    <div style={{ padding: 16 }}>
      <EmptyCompact title="Empty Panel" description="This panel has no content yet." />
    </div>
  ),
};

export const ErrorDefault: Story = {
  render: () => <ErrorAlert message="Something went wrong. Please try again." />,
};

export const ErrorWithRetry: Story = {
  render: () => (
    <ErrorAlert
      title="API Error"
      message="Failed to load data."
      withRetry
      onRetry={() => {}}
    />
  ),
};
