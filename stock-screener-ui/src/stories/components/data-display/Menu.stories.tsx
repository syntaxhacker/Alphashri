import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Box, Button, Group, Menu, MenuDropdown, MenuItem, MenuTarget, Stack, Text, ToolbarRow,
} from "@/ui";
import {
  IconAlertTriangle, IconBookmarkPlus, IconPencil, IconPlayerPlay, IconTrash,
} from "@/ui/icons";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Data display/Menu",
  tags: ["autodocs"],
  component: Menu as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Menu pairs a MenuTarget with a fixed, viewport-clamped MenuDropdown. `trigger` selects click / hover / click-hover, `position` and `offset` steer placement, `withArrow` adds the arrow and `closeOnItemClick` / `closeOnClickOutside` control dismissal. MenuItem takes `leftSection` / `rightSection` for icons and shortcuts, `disabled` to block activation and `color` for tone — error and danger both map to the negative token. Children can also be a render function receiving `{ open, close }`.",
      },
    },
  },
  argTypes: {
    trigger: { control: "select", options: ["click", "hover", "click-hover"], description: "What opens the menu." },
    opened: { control: "boolean", description: "Controlled open state; pair with onChange." },
    position: {
      control: "select",
      options: ["bottom-start", "bottom", "bottom-end", "top-start", "top", "top-end", "left-start", "right-start"],
      description: "Preferred placement; the dropdown flips and clamps to the viewport when needed.",
    },
    offset: { control: "number", description: "Gap in px between target and dropdown." },
    withArrow: { control: "boolean", description: "Render the small rotated arrow on the dropdown." },
    closeOnItemClick: { control: "boolean", description: "Dismiss after an item is activated (default true)." },
    closeOnClickOutside: { control: "boolean", description: "Dismiss on an outside mousedown (default true)." },
    onChange: { action: "menu opened changed", description: "Called with the next open state." },
  },
  args: { trigger: "click", position: "bottom-start", offset: 4, withArrow: false, closeOnItemClick: true },
};
export default meta;
type Story = StoryObj;

export const OpenMenu: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Open menu"
          code="opened · closeOnClickOutside={false}"
          note="Frozen controlled state with realistic items: the dropdown is on screen without a click."
        >
          <Box
            style={{
              position: "relative",
              height: "184px",
              padding: "12px",
              border: "1px solid var(--color-fin-border)",
              "border-radius": "4px",
              background: "var(--color-fin-surface-alt)",
            }}
          >
            <Menu opened position="bottom-start" offset={4} closeOnClickOutside={false} closeOnItemClick={false} onChange={() => undefined}>
              <MenuTarget>
                <Button size="sm" variant="outline">Bulk actions · 3 selected</Button>
              </MenuTarget>
              <MenuDropdown>
                <Menu.Label>Paper positions</Menu.Label>
                <MenuItem leftSection={<IconPlayerPlay size={14} aria-hidden="true" />} rightSection="Enter">
                  Replay fills
                </MenuItem>
                <MenuItem leftSection={<IconBookmarkPlus size={14} aria-hidden="true" />}>Save view</MenuItem>
                <Menu.Divider />
                <MenuItem color="error" leftSection={<IconTrash size={14} aria-hidden="true" />}>
                  Close selected
                </MenuItem>
              </MenuDropdown>
            </Menu>
          </Box>
        </Specimen>
      </Page>
    )),
};

export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [last, setLast] = createSignal("none");
      return (
        <Page>
          <Specimen title="Playground" code={`trigger="${String(args.trigger)}" · position="${String(args.position)}"`}>
            <Stack gap="sm">
              <Readout>open: {String(opened())} · last action: {last()}</Readout>
              <Menu
                trigger={args.trigger}
                opened={opened()}
                onChange={setOpened}
                position={args.position}
                offset={args.offset}
                withArrow={args.withArrow}
                closeOnItemClick={args.closeOnItemClick}
                closeOnClickOutside={args.closeOnClickOutside}
              >
                <MenuTarget>
                  <Button size="sm" variant="outline" aria-label="Open playground actions">Actions</Button>
                </MenuTarget>
                <MenuDropdown>
                  <MenuItem onClick={() => setLast("Replay structure")}>Replay structure</MenuItem>
                  <MenuItem onClick={() => setLast("Add leg")}>Add leg</MenuItem>
                </MenuDropdown>
              </Menu>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const ItemsAndIcons: Story = {
  render: () =>
    solidStory(() => {
      const [last, setLast] = createSignal("none");
      return (
        <Page>
          <Specimen
            title="Items, icons and sections"
            note="leftSection holds a real icon; rightSection holds the shortcut hint. Menu.Label and Menu.Divider group items."
          >
            <Group gap="md" align="center" wrap="wrap">
              <Menu position="bottom-start" offset={4}>
                <MenuTarget>
                  <Button size="sm" variant="outline" aria-label="Open strategy actions">Strategy actions</Button>
                </MenuTarget>
                <MenuDropdown>
                  <Menu.Label>Strategy</Menu.Label>
                  <MenuItem leftSection={<IconPencil size={14} aria-hidden="true" />} onClick={() => setLast("Edit")}>Edit</MenuItem>
                  <MenuItem leftSection={<IconPlayerPlay size={14} aria-hidden="true" />} rightSection="Enter" onClick={() => setLast("Run")}>Run</MenuItem>
                  <MenuItem leftSection={<IconBookmarkPlus size={14} aria-hidden="true" />} onClick={() => setLast("Save copy")}>Save copy</MenuItem>
                  <Menu.Divider />
                  <Menu.Label>Danger zone</Menu.Label>
                  <MenuItem leftSection={<IconTrash size={14} aria-hidden="true" />} color="error" onClick={() => setLast("Delete")}>Delete strategy</MenuItem>
                </MenuDropdown>
              </Menu>
              <Readout>last: {last()}</Readout>
            </Group>
          </Specimen>
        </Page>
      );
    }),
};

export const DisabledAndDanger: Story = {
  render: () =>
    solidStory(() => {
      const [last, setLast] = createSignal("none");
      return (
        <Page>
          <Specimen
            title="Disabled and danger items"
            note="disabled blocks onClick and renders a muted label. color='danger' is an alias of color='error'."
          >
            <Stack gap="sm">
              <Menu position="bottom-start" offset={4} withArrow>
                <MenuTarget>
                  <Button size="sm" variant="outline" aria-label="Open order actions">Order actions</Button>
                </MenuTarget>
                <MenuDropdown>
                  <MenuItem onClick={() => setLast("Modify")}>Modify order</MenuItem>
                  <MenuItem disabled>Export (unavailable)</MenuItem>
                  <Menu.Divider />
                  <MenuItem
                    color="danger"
                    leftSection={<IconAlertTriangle size={14} aria-hidden="true" />}
                    onClick={() => setLast("Close position")}
                  >
                    Close position
                  </MenuItem>
                  <MenuItem color="success" onClick={() => setLast("Resume")}>Resume strategy</MenuItem>
                  <MenuItem color="info" onClick={() => setLast("Inspect")}>Inspect fills</MenuItem>
                </MenuDropdown>
              </Menu>
              <Readout>last: {last()}</Readout>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const TriggerModes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen
            title="Trigger modes"
            code='trigger="click"'
            note="Click the target to open; click again or press Escape to close."
          >
            <Menu trigger="click">
              <MenuTarget><Button size="sm" variant="outline" aria-label="Open click menu">Click menu</Button></MenuTarget>
              <MenuDropdown><MenuItem>One</MenuItem><MenuItem>Two</MenuItem></MenuDropdown>
            </Menu>
          </Specimen>
          <Specimen
            title="Trigger modes"
            code='trigger="hover"'
            note="Hovering the target opens the menu without a click."
          >
            <Menu trigger="hover">
              <MenuTarget><Button size="sm" variant="outline" aria-label="Open hover menu">Hover menu</Button></MenuTarget>
              <MenuDropdown><MenuItem>One</MenuItem><MenuItem>Two</MenuItem></MenuDropdown>
            </Menu>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => {
      const [last, setLast] = createSignal("none");
      return (
        <Page>
          <Specimen title="Composition" note="A bulk-action menu inside the same ToolbarRow used by the app.">
            <Stack gap="sm">
              <ToolbarRow>
                <Text size="sm" fw={600} style={{ flex: 1 }}>Paper positions · 3 selected</Text>
                <Menu position="bottom-end" offset={4}>
                  <MenuTarget><Button size="xs" variant="outline" aria-label="Open bulk position actions">Bulk actions</Button></MenuTarget>
                  <MenuDropdown>
                    <MenuItem leftSection={<IconPlayerPlay size={14} aria-hidden="true" />} onClick={() => setLast("Replay fills")}>Replay fills</MenuItem>
                    <MenuItem disabled>Export CSV (unavailable)</MenuItem>
                    <Menu.Divider />
                    <MenuItem color="error" leftSection={<IconTrash size={14} aria-hidden="true" />} onClick={() => setLast("Close all")}>Close all</MenuItem>
                  </MenuDropdown>
                </Menu>
              </ToolbarRow>
              <SampleRow label="Symbols" value="NIFTY · BANKNIFTY · FINNIFTY" />
              <Readout>last action: {last()}</Readout>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};
