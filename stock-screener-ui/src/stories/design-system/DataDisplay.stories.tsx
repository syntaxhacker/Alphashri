import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Accordion, Box, Button, DENSITY_TOKENS, Group, List, ListItem, Menu, MenuDropdown, MenuItem, MenuTarget,
  Stack, Tab, Tabs, TabsList, TabsPanel, Text, Timeline, Tree, type Density,
} from "@/ui";

const meta: Meta = { title: "Design System/Data display", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const TabsExample: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal("overview");
      return (
        <Stack gap="sm" style={{ width: "620px" }}>
          <Text size="xs" c="dimmed">Selected tab: {value()}</Text>
          <Tabs value={value()} onChange={(next) => setValue(next ?? "overview")}>
            <TabsList>
              <Tab value="overview">OVERVIEW</Tab>
              <Tab value="flow">FLOW</Tab>
              <Tab value="levels">LEVELS</Tab>
              <Tab value="locked" disabled>LOCKED</Tab>
            </TabsList>
            <TabsPanel value="overview" style={{ padding: "12px" }}>
              <Text size="sm">Overview panel — market breadth, spot, and the current regime.</Text>
            </TabsPanel>
            <TabsPanel value="flow" style={{ padding: "12px" }}>
              <Text size="sm">Flow panel — delivery, volume, and participant activity.</Text>
            </TabsPanel>
            <TabsPanel value="levels" style={{ padding: "12px" }}>
              <Text size="sm">Levels panel — support, resistance, and wall levels.</Text>
            </TabsPanel>
          </Tabs>
        </Stack>
      );
    }),
};

export const AccordionExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "620px" }}>
        <Accordion defaultValue="filters" variant="separated">
          <Accordion.Item value="filters">
            <Accordion.Control>Filters</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed" style={{ padding: "8px" }}>Sector, cap tier, and quality filters live here.</Text>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="risk">
            <Accordion.Control>Risk controls</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed" style={{ padding: "8px" }}>Position size, daily loss limit, and exposure caps.</Text>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="execution">
            <Accordion.Control>Execution</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed" style={{ padding: "8px" }}>Slippage, cooldown, and entry timing.</Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Box>
    )),
};

export const TimelineExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "420px" }}>
        <Timeline active={1} bulletSize={18} lineWidth={1}>
          <Timeline.Item title="10:00 · Scan">
            Universe scanned; 214 symbols had a valid frame.
          </Timeline.Item>
          <Timeline.Item title="10:01 · Filter">
            Filters narrowed the list to 18 actionable rows.
          </Timeline.Item>
          <Timeline.Item title="10:02 · Paper order">
            Structure previewed and sent to the paper book.
          </Timeline.Item>
        </Timeline>
      </Box>
    )),
};

const treeData = [
  {
    value: "fno",
    label: "F&O",
    children: [
      { value: "nifty", label: "NIFTY" },
      { value: "banknifty", label: "BANKNIFTY" },
    ],
  },
  {
    value: "cash",
    label: "Cash",
    children: [
      { value: "reliance", label: "RELIANCE" },
      { value: "tcs", label: "TCS" },
    ],
  },
];

export const TreeExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "360px" }}>
        <Tree data={treeData} levelOffset={20} />
      </Box>
    )),
};

export const MenuExample: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [action, setAction] = createSignal("none");
      return (
        <Stack gap="sm">
          <Text size="xs" c="dimmed">Open: {String(opened())} · last action: {action()}</Text>
          <Box style={{ width: "320px" }}>
            <Menu opened={opened()} onChange={setOpened}>
              <MenuTarget>
                <Button variant="outline">Actions</Button>
              </MenuTarget>
              <MenuDropdown>
                <MenuItem onClick={() => setAction("Replay structure")}>Replay structure</MenuItem>
                <MenuItem onClick={() => setAction("Add leg")}>Add leg</MenuItem>
                <MenuItem disabled>Export (unavailable)</MenuItem>
                <Menu.Divider />
                <MenuItem color="error" onClick={() => setAction("Close position")}>Close position</MenuItem>
              </MenuDropdown>
            </Menu>
          </Box>
        </Stack>
      );
    }),
};

export const ListExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "420px" }}>
        <Text size="sm" fw={600}>Pre-flight checklist</Text>
        <List size="sm" withPadding>
          <ListItem>Frame is fresh and session-pinned.</ListItem>
          <ListItem icon={<span aria-hidden="true">→</span>}>Universe scanned with no stale rows.</ListItem>
          <ListItem>Margin and risk limits verified.</ListItem>
        </List>
        <Text size="sm" fw={600} style={{ "margin-top": "12px" }}>Commit steps</Text>
        <List type="ordered" size="sm" withPadding>
          <ListItem>Build the structure.</ListItem>
          <ListItem>Preview the debit.</ListItem>
          <ListItem>Commit to the paper book.</ListItem>
        </List>
      </Box>
    )),
};

/**
 * Tree/Accordion/Timeline do not read the density store themselves. Both
 * columns mount the same real components; the host padding and row rhythm come
 * from DENSITY_TOKENS, the same object the shared table reads.
 */
const DensitySurface = (props: { density: Density }) => {
  const t = DENSITY_TOKENS[props.density];
  const rowPad = () => ({
    padding: t.tableCellPad,
    "min-height": `${t.tableRowHeight}px`,
    "border-bottom": "1px solid var(--color-fin-border)",
  });
  return (
    <Box style={{ width: "300px", "flex-shrink": 0, border: "1px solid var(--color-fin-border)", background: "var(--color-fin-surface)" }}>
      <Box style={{ padding: t.tableCellPad, "border-bottom": "1px solid var(--color-fin-border)" }}>
        <Text size="xs" fw={700} c="dimmed" className="font-mono">
          {`${props.density} · row ${t.tableRowHeight}px · py ${t.tableRowPy} · pad ${t.tableCellPad}`}
        </Text>
      </Box>
      <Box style={rowPad()}>
        <Accordion defaultValue="nifty">
          <Accordion.Item value="nifty">
            <Accordion.Control style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>
              F&O universe
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="xs" c="dimmed" style={{ padding: t.tableCellPad }}>
                NIFTY and BANKNIFTY chain roots.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Box>
      <Box style={rowPad()}>
        <Tree data={treeData} levelOffset={16} style={{ padding: t.tableCellPad, "row-gap": t.tableRowPy }} />
      </Box>
      <Box style={rowPad()}>
        <Timeline active={1} bulletSize={12} lineWidth={1}>
          <Timeline.Item title="Scan" style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>
            214 symbols with a valid frame.
          </Timeline.Item>
          <Timeline.Item title="Filter" style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>
            18 actionable rows.
          </Timeline.Item>
        </Timeline>
      </Box>
    </Box>
  );
};

export const DensityStack: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="sm" style={{ width: "640px" }}>
        <Text size="xs" c="dimmed">
          Same three real components at both densities. The wrappers read DENSITY_TOKENS directly — row 20/28px and cell pad 3px 8px / 6px 12px — because density.tsx has no provider these data-display primitives subscribe to.
        </Text>
        <Group gap="md" align="flex-start" wrap="wrap">
          <DensitySurface density="compact" />
          <DensitySurface density="comfortable" />
        </Group>
      </Stack>
    )),
};
