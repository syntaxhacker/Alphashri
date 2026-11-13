import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { EmptyState, ErrorAlert, InlineLoader } from "./states";

const meta: Meta = { title: "Terminal/States", tags: ["autodocs"] };
export default meta;

type Story = StoryObj;

export const Empty: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "520px" }}>
        <EmptyState title="No rows for this filter" description="Widen the strike range or switch expiry." />
      </div>
    )),
};

export const Loading: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "520px" }}>
        <InlineLoader message="Loading option chain" />
      </div>
    )),
};

export const Error: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ width: "520px" }}>
        <ErrorAlert title="Feed unavailable" message="The options tape returned 503." withRetry onRetry={() => {}} />
      </div>
    )),
};
