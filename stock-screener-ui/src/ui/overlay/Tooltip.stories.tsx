import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Title, Button, Group } from "@mantine/core";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Design System/UI/Overlay/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Positions: Story = {
  render: () => (
    <Stack gap="md" p="xl">
      <Title order={5}>Top / bottom positions (hover the buttons)</Title>
      <Group gap="lg">
        <Tooltip label="Refresh live prices" position="top" withArrow>
          <Button variant="default">Top</Button>
        </Tooltip>
        <Tooltip label="Close all open positions" position="bottom" withArrow>
          <Button variant="default">Bottom</Button>
        </Tooltip>
      </Group>
    </Stack>
  ),
};

export const DelayedAndMultiline: Story = {
  render: () => (
    <Stack gap="md" p="xl">
      <Title order={5}>Open delay + multiline + colored</Title>
      <Group gap="lg">
        <Tooltip label="Appears after 500ms" position="top" openDelay={500}>
          <Button variant="light" color="blue">Open delay</Button>
        </Tooltip>
        <Tooltip
          multiline
          style={{ maxWidth: 220 }}
          withArrow
          label="Strategy pauses for the rest of the day after 3 consecutive stop-loss hits."
          position="bottom"
        >
          <Button variant="light" color="violet">Multiline</Button>
        </Tooltip>
        <Tooltip label="Danger zone" color="red" position="top" withArrow>
          <Button variant="light" color="red">Colored</Button>
        </Tooltip>
        <Tooltip label="You cannot interact with this" disabled position="top">
          <Button disabled>Disabled tooltip</Button>
        </Tooltip>
      </Group>
    </Stack>
  ),
};
