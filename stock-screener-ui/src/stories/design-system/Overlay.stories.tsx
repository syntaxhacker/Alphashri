import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Box, Button, FloatingWindow, Group, Modal, Overlay, Popover, PopoverDropdown,
  PopoverTarget, Stack, Text, Tooltip,
} from "@/ui";

const meta: Meta = { title: "Design System/Overlay", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const ModalExample: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Button onClick={() => setOpened(true)}>Open paper order</Button>
            <Text size="xs" c="dimmed">opened: {String(opened())}</Text>
          </Group>
          <Text size="xs" c="dimmed">
            The dialog mounts only while open. The × button, backdrop click and Escape all call onClose.
          </Text>
          <Modal opened={opened()} onClose={() => setOpened(false)} title="Paper order" size="md">
            <Stack gap="sm">
              <Text size="sm">BUY 1 lot NIFTY 23,500 CE at the live LTP.</Text>
              <Text size="xs" c="dimmed">Estimated debit and charges are shown before confirmation.</Text>
              <Group gap="sm">
                <Button color="success" onClick={() => setOpened(false)}>Commit to paper book</Button>
                <Button variant="outline" onClick={() => setOpened(false)}>Cancel</Button>
              </Group>
            </Stack>
          </Modal>
        </Stack>
      );
    }),
};

export const TooltipExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ padding: "80px" }}>
        <Group gap="lg">
          <Tooltip label="Refresh the option chain" position="top" withArrow>
            <Button variant="outline">Hover · top</Button>
          </Tooltip>
          <Tooltip label="Persisted per underlying and expiry" position="bottom" withArrow>
            <Button variant="outline">Hover · bottom</Button>
          </Tooltip>
        </Group>
      </Box>
    )),
};

export const PopoverExample: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [saved, setSaved] = createSignal(false);
      return (
        <Box style={{ padding: "80px" }}>
          <Stack gap="sm">
            <Text size="xs" c="dimmed">Open: {String(opened())} · settings saved: {String(saved())}</Text>
            <Popover
              opened={opened()}
              onChange={setOpened}
              position="bottom-start"
              withArrow
              width={280}
            >
              <PopoverTarget>
                <Button variant="outline">Structure settings</Button>
              </PopoverTarget>
              <PopoverDropdown p="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>Structure settings</Text>
                  <Text size="xs" c="dimmed">Persisted per underlying and expiry.</Text>
                  <Button
                    size="xs"
                    onClick={() => {
                      setSaved(true);
                      setOpened(false);
                    }}
                  >
                    {saved() ? "Saved ✓" : "Save settings"}
                  </Button>
                </Stack>
              </PopoverDropdown>
            </Popover>
          </Stack>
        </Box>
      );
    }),
};

export const OverlayExample: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
              {visible() ? "Hide overlay" : "Show overlay"}
            </Button>
          </Group>
          <Box style={{ position: "relative", height: "180px", border: "1px solid var(--color-fin-border)" }}>
            <Box p="sm">Background content</Box>
            <Show when={visible()}>
              <Overlay fixed={false} center>
                <Box p="md" style={{ background: "var(--color-fin-surface)", border: "1px solid var(--color-fin-border)" }}>
                  <Text size="sm">Overlay content</Text>
                </Box>
              </Overlay>
            </Show>
          </Box>
        </Stack>
      );
    }),
};

export const FloatingWindowExample: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      const [minimized, setMinimized] = createSignal(false);
      const [geometry, setGeometry] = createSignal({ x: 24, y: 24, width: 420, height: 240 });
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
              {visible() ? "Close window" : "Reopen window"}
            </Button>
            <Button size="xs" variant="outline" disabled={!visible()} onClick={() => setMinimized((v) => !v)}>
              {minimized() ? "Restore" : "Minimize"}
            </Button>
            <Text size="xs" c="dimmed">geometry: {geometry().width}×{geometry().height}</Text>
          </Group>
          <Box style={{ position: "relative", height: "360px", border: "1px solid var(--color-fin-border)", overflow: "hidden" }}>
            <Show when={visible()}>
              <FloatingWindow
                title="OPTIONS REPLAY"
                geometry={geometry()}
                z-index={3}
                minimized={minimized()}
                onClose={() => setVisible(false)}
                onMinimize={() => setMinimized((v) => !v)}
                onGeometryChange={setGeometry}
                testid="story-floating-window"
              >
                <Box p="sm">
                  <Text size="sm" fw={600}>Replay path · NIFTY</Text>
                  <Text size="xs" c="dimmed">Drag the title bar or any edge to resize; the geometry readout above updates.</Text>
                </Box>
              </FloatingWindow>
            </Show>
          </Box>
        </Stack>
      );
    }),
};
