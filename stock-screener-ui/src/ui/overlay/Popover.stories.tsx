import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack, Text, Title, Button, Group } from "@mantine/core";
import { Popover, PopoverTarget, PopoverDropdown } from "./Popover";

const meta: Meta<typeof Popover> = {
  title: "Design System/UI/Overlay/Popover",
  component: Popover,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Uncontrolled: Story = {
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Uncontrolled — click target to toggle</Title>
      <Popover position="bottom" withArrow shadow="md" width={260}>
        <PopoverTarget>
          <Button variant="default">Filter columns</Button>
        </PopoverTarget>
        <PopoverDropdown>
          <Stack gap="xs">
            <Text size="sm">Show columns:</Text>
            <Text size="sm">· Symbol · P&L · SL · TP</Text>
            <Text size="xs" c="dimmed">Click outside to close.</Text>
          </Stack>
        </PopoverDropdown>
      </Popover>
    </Stack>
  ),
};

function ControlledPopover() {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onClose={() => setOpened(false)} position="bottom-start" withArrow offset={8}>
      <PopoverTarget>
        <Button onClick={() => setOpened((o) => !o)} variant={opened ? "filled" : "light"}>
          {opened ? "Hide details" : "Show details"}
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <Group justify="space-between" gap="xl">
          <Text size="sm">Entry: ₹2,410.50</Text>
          <Text size="sm" c="teal">P&L: +1.24%</Text>
        </Group>
        <Button size="compact-sm" mt="xs" variant="subtle" color="red" onClick={() => setOpened(false)}>
          Dismiss
        </Button>
      </PopoverDropdown>
    </Popover>
  );
}

export const Controlled: Story = {
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Controlled with local state</Title>
      <ControlledPopover />
    </Stack>
  ),
};
