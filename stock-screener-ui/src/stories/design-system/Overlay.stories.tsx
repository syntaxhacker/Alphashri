import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, FloatingWindow, Modal, Overlay, Popover, PopoverDropdown, PopoverTarget, Stack, Text, Tooltip } from "@/ui";

const meta: Meta = { title: "Design System/Overlay", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const ModalExample: Story = {
  render: () =>
    solidStory(() => (
      <Modal opened onClose={() => {}} title="Paper order" size="md">
        <Stack gap="sm">
          <Text size="sm">BUY 1 lot NIFTY 23,500 CE at the live LTP.</Text>
          <Text size="xs" c="dimmed">Estimated debit and charges are shown before confirmation.</Text>
          <Button color="success">Commit to paper book</Button>
        </Stack>
      </Modal>
    )),
};

export const TooltipExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ padding: "80px" }}>
        <Tooltip label="Refresh the option chain" position="top">
          <Button variant="outline">Hover for tooltip</Button>
        </Tooltip>
      </Box>
    )),
};

export const PopoverExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ padding: "80px" }}>
        <Popover
          opened
          position="bottom-start"
          withArrow
          width={280}
          onClose={() => {}}
          onChange={() => {}}
        >
          <PopoverTarget>
            <Button variant="outline">Open popover</Button>
          </PopoverTarget>
          <PopoverDropdown>
            <Stack gap="xs">
              <Text size="sm" fw={600}>Structure settings</Text>
              <Text size="xs" c="dimmed">Persisted per underlying and expiry.</Text>
            </Stack>
          </PopoverDropdown>
        </Popover>
      </Box>
    )),
};

export const OverlayExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ position: "relative", height: "180px", border: "1px solid var(--color-fin-border)" }}>
        <Box p="sm">Background content</Box>
        <Overlay fixed={false} center>
          <Box p="md" style={{ background: "var(--color-fin-surface)", border: "1px solid var(--color-fin-border)" }}>
            <Text size="sm">Overlay content</Text>
          </Box>
        </Overlay>
      </Box>
    )),
};

export const FloatingWindowExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ position: "relative", height: "360px", border: "1px solid var(--color-fin-border)", overflow: "hidden" }}>
        <FloatingWindow
          title="OPTIONS REPLAY"
          geometry={{ x: 24, y: 24, width: 480, height: 260 }}
          z-index={3}
          testid="story-floating-window"
        >
          <Box p="sm">
            <Text size="sm" fw={600}>Replay path · NIFTY</Text>
            <Text size="xs" c="dimmed">Draggable and resizable in the terminal window manager.</Text>
          </Box>
        </FloatingWindow>
      </Box>
    )),
};
