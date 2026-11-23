import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import {
  Alert, Badge, Box, Button, Group, Indicator, Loader, LoadingOverlay, Notifications, Progress,
  RingProgress, Skeleton, Stack, Text, showSuccess,
} from "@/ui";

const meta: Meta = { title: "Design System/Feedback", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const Badges: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <Group gap="sm">
          <Badge>Default</Badge>
          <Badge variant="light" color="success">Positive</Badge>
          <Badge variant="light" color="error">Negative</Badge>
          <Badge variant="light" color="warning">Warning</Badge>
          <Badge variant="outline" color="info">Outline</Badge>
          <Badge variant="dot" color="success">Live</Badge>
          <Badge size="xs">xs</Badge>
          <Badge size="lg">lg</Badge>
        </Group>
        <Group gap="sm">
          <Badge variant="filled" color="success" leftSection={<span>●</span>}>Filled</Badge>
          <Badge variant="light" color="secondary" rightSection={<span>12</span>}>Count</Badge>
        </Group>
      </Stack>
    )),
};

export const Alerts: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="sm" style={{ "max-width": "640px" }}>
        <Alert color="success" title="Order accepted">The paper order was written to the book.</Alert>
        <Alert color="warning" title="Short leg margin">Short options require margin; verify the estimate.</Alert>
        <Alert color="error" title="Feed unavailable">The options chain returned 503.</Alert>
        <Alert color="info">A neutral informational alert with no title.</Alert>
      </Stack>
    )),
};

export const NotificationsExample: Story = {
  render: () =>
    solidStory(() => (
      <Notifications>
        <Button onClick={() => showSuccess("Order accepted", "The paper order was written to the book.")}>
          Show success notification
        </Button>
      </Notifications>
    )),
};

export const ProgressAndLoaders: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "640px" }}>
        <div style={{ display: "grid", gap: "8px" }}>
          <Text size="xs" c="dimmed">Progress / 62%</Text>
          <Progress value={62} />
          <Progress value={38} color="warning" striped animated />
          <Progress value={100} color="success" size="sm" />
        </div>
        <Group gap="lg" align="center">
          <Loader />
          <Loader type="dots" />
          <Loader size="sm" color="success" />
          <RingProgress
            value={72}
            sections={[
              { value: 72, color: "success" },
              { value: 28, color: "secondary" },
            ]}
            label={<Text size="xs" fw={700}>72%</Text>}
          />
        </Group>
        <div style={{ position: "relative", height: "110px", border: "1px solid var(--color-fin-border)" }}>
          <Box p="sm">Content under a loading overlay.</Box>
          <LoadingOverlay visible />
        </div>
      </Stack>
    )),
};

export const SkeletonsAndIndicators: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg">
        <Group gap="md" align="center">
          <Skeleton h={18} w={180} />
          <Skeleton h={18} w={90} />
          <Skeleton circle h={40} w={40} />
          <Skeleton h={80} w={240} />
        </Group>
        <Group gap="xl" align="center" style={{ "padding-top": "16px" }}>
          <Indicator label="3" color="error">
            <Button variant="outline">Alerts</Button>
          </Indicator>
          <Indicator label="LIVE" color="success" processing>
            <Button variant="outline">Feed</Button>
          </Indicator>
          <Indicator label="9+" color="warning">
            <Button variant="outline">Queue</Button>
          </Indicator>
        </Group>
      </Stack>
    )),
};
