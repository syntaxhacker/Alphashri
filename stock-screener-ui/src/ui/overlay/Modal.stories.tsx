import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack, Text, Title, Button, Group } from "@/ui";
import { Modal } from "./Modal";

const meta: Meta<typeof Modal> = {
  title: "Primitives/Overlays/Modal",
  component: Modal,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Focused dialog with overlay and close. Use for confirmations, forms, or detail views. When not to use: for non-blocking info use Popover. Uses MUI Modal with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Modal>;

function OpenByDefault() {
  const [opened, setOpened] = useState(true);
  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title="Confirm force exit">
      <Text size="sm" mb="md">
        This will close all open positions at market price. Continue?
      </Text>
      <Group justify="flex-end" gap="sm">
        <Button variant="subtle" onClick={() => setOpened(false)}>Cancel</Button>
        <Button color="error" onClick={() => setOpened(false)}>Force exit</Button>
      </Group>
    </Modal>
  );
}

export const OpenByDefaultStory: Story = {
  name: "Open by default",
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Modal starts open — close it to dismiss</Title>
      <OpenByDefault />
    </Stack>
  ),
};

function TriggeredModal() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button onClick={() => setOpened(true)}>Close all positions</Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Close all positions"
        centered
        overlayProps={{ opacity: 0.55, blur: 2 }}
      >
        <Text size="sm" mb="md">
          3 open positions will be closed at market price. This cannot be undone.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setOpened(false)}>Keep positions</Button>
          <Button color="error" onClick={() => setOpened(false)}>Close all</Button>
        </Group>
      </Modal>
    </>
  );
}

export const WithTrigger: Story = {
  render: () => (
    <Stack gap="sm" p="xl">
      <Title order={5}>Closed by default with trigger button</Title>
      <TriggeredModal />
    </Stack>
  ),
};
