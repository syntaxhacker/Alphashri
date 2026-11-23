import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Badge, Box, Button, Card, Divider, Flex, FloatingWindow, Group, Modal, Overlay, Paper,
  Popover, PopoverDropdown, PopoverTarget, Stack, Text, Title, Tooltip,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Overlay",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for layered surfaces: modal dialogs, tooltips, popovers, blocking overlays and floating windows. Each component has its own page under Design System/Components/Overlay; this page is an index plus a few composed examples from a frozen order fixture.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const docsHref = (id: string) => `../?path=/docs/${id}`;
const DocsLink = (props: { id: string; label: string }) => (
  <Anchor href={docsHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

type ComponentRef = { id: string; name: string; note: string };
const components: ComponentRef[] = [
  { id: "design-system-components-overlay-floatingwindow--docs", name: "FloatingWindow", note: "Draggable, resizable title-bar window" },
  { id: "design-system-components-overlay-modal--docs", name: "Modal", note: "Focused dialog with backdrop dismissal" },
  { id: "design-system-components-overlay-overlay--docs", name: "Overlay", note: "Block or dim a bounded region" },
  { id: "design-system-components-overlay-popover--docs", name: "Popover", note: "Anchored settings panel" },
  { id: "design-system-components-overlay-tooltip--docs", name: "Tooltip", note: "Hover hint with an optional arrow" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component pages</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">Overview · order ticket chrome</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Index</Text>
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open each card to reach its dedicated page.</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <DocsLink id={item.id} label={item.name} />
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

const Specimen = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

const TicketChromeSpecimen = () => {
  const [opened, setOpened] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  return (
    <Stack gap="sm" style={{ "max-width": "720px" }}>
      <Group gap="sm" align="center" wrap="wrap">
        <Tooltip label="Refresh the option chain" position="top" withArrow>
          <Button variant="outline" size="sm">Refresh chain</Button>
        </Tooltip>
        <Popover opened={settingsOpen()} onChange={setSettingsOpen} position="bottom-start" withArrow width={280}>
          <PopoverTarget>
            <Button variant="outline" size="sm">Structure settings</Button>
          </PopoverTarget>
          <PopoverDropdown p="sm">
            <Stack gap="xs">
              <Text size="sm" fw={600}>Structure settings</Text>
              <Text size="xs" c="dimmed">Persisted per underlying and expiry.</Text>
              <Button size="xs" onClick={() => { setSaved(true); setSettingsOpen(false); }}>
                {saved() ? "Saved" : "Save settings"}
              </Button>
            </Stack>
          </PopoverDropdown>
        </Popover>
        <Button size="sm" onClick={() => setOpened(true)}>Open paper order</Button>
        <Text size="xs" c="dimmed">Dialog: {String(opened())}</Text>
      </Group>
      <Modal opened={opened()} onClose={() => setOpened(false)} title="Paper order" size="md">
        <Stack gap="sm">
          <Text size="sm">BUY 1 lot NIFTY 23,500 CE at the live LTP.</Text>
          <Text size="xs" c="dimmed">Estimated debit and charges are shown before confirmation.</Text>
          <Group gap="sm" wrap="wrap">
            <Button color="success" onClick={() => setOpened(false)}>Commit to paper book</Button>
            <Button variant="outline" onClick={() => setOpened(false)}>Cancel</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

const OverlaySpecimen = () => {
  const [visible, setVisible] = createSignal(true);
  return (
    <Stack gap="sm">
      <Group gap="sm" align="center" wrap="wrap">
        <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
          {visible() ? "Hide overlay" : "Show overlay"}
        </Button>
        <Text size="xs" c="dimmed">Blocking a bounded region, not the page.</Text>
      </Group>
      <Box style={{ position: "relative", height: "140px", border: `1px solid ${palette.BORDER}`, background: palette.SURFACE_ALT }}>
        <Box p="sm"><Text size="sm">Background content</Text></Box>
        <Show when={visible()}>
          <Overlay fixed={false} center>
            <Box p="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
              <Text size="sm">Overlay content</Text>
            </Box>
          </Overlay>
        </Show>
      </Box>
    </Stack>
  );
};

const FloatingSpecimen = () => {
  const [visible, setVisible] = createSignal(true);
  const [minimized, setMinimized] = createSignal(false);
  const [geometry, setGeometry] = createSignal({ x: 24, y: 24, width: 420, height: 240 });
  return (
    <Stack gap="sm">
      <Group gap="sm" align="center" wrap="wrap">
        <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
          {visible() ? "Close window" : "Reopen window"}
        </Button>
        <Button size="xs" variant="outline" disabled={!visible()} onClick={() => setMinimized((v) => !v)}>
          {minimized() ? "Restore" : "Minimize"}
        </Button>
        <Text size="xs" c="dimmed">geometry: {geometry().width} by {geometry().height}</Text>
      </Group>
      <Box style={{ position: "relative", height: "260px", border: `1px solid ${palette.BORDER}`, background: palette.SURFACE_ALT, overflow: "hidden" }}>
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
              <Text size="xs" c="dimmed">Drag the title bar or any edge to resize; the readout above updates.</Text>
            </Box>
          </FloatingWindow>
        </Show>
      </Box>
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", margin: "0 auto", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Overlay"
          count={components.length}
          purpose="Surfaces that sit above the current view: tooltips for a hint, popovers for a short task, modals for confirmation, overlays to block a region and floating windows for a persistent side desk. Open one at a time and give each a clear dismissal path."
          specimen={<TicketChromeSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Overlay" note="A local blocker keeps the rest of the panel visible and readable.">
          <OverlaySpecimen />
        </Specimen>
        <Specimen title="FloatingWindow" note="Title bar and edges drive geometry through the same controlled props.">
          <FloatingSpecimen />
        </Specimen>
        <Specimen title="Tooltip placement" note="Top and bottom positions with arrows; hover to inspect.">
          <Box style={{ padding: "56px 8px 8px" }}>
            <Group gap="lg" align="center" wrap="wrap">
              <Tooltip label="Refresh the option chain" position="top" withArrow>
                <Button variant="outline">Hover · top</Button>
              </Tooltip>
              <Tooltip label="Persisted per underlying and expiry" position="bottom" withArrow>
                <Button variant="outline">Hover · bottom</Button>
              </Tooltip>
            </Group>
          </Box>
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · per-component pages: <code>src/stories/components/Overlay</code>.</Text>
      </Stack>
    )),
};
