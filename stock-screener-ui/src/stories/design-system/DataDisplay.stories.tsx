import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Accordion, Anchor, Badge, Box, Button, Card, Divider, DENSITY_TOKENS, Flex, Group, List, ListItem,
  Menu, MenuDropdown, MenuItem, MenuTarget, Paper, Stack, Tab, Tabs, TabsList, TabsPanel, Text, Timeline, Title, Tree,
  type Density,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Data display",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the primitives that present structured data: tabs, accordions, timelines, trees, menus and lists. Each component has its own page under Design System/Components/Data display; this page is an index plus a small set of composed examples.",
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
  { id: "design-system-components-data-display-accordion--docs", name: "Accordion", note: "Separated disclosure panels" },
  { id: "design-system-components-data-display-menu--docs", name: "Menu", note: "Action list with target and divider" },
  { id: "design-system-components-data-display-tabs--docs", name: "Tabs", note: "Controlled views with a disabled tab" },
  { id: "design-system-components-data-display-timeline--docs", name: "Timeline", note: "Ordered events with an active step" },
  { id: "design-system-components-data-display-tree--docs", name: "Tree", note: "Hierarchical universe navigator" },
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
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">Overview · scan workflow</Text>
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

const WorkflowSpecimen = () => {
  const [tab, setTab] = createSignal("overview");
  return (
    <Stack gap="sm" style={{ "max-width": "720px" }}>
      <Group gap="sm" align="center" wrap="wrap">
        <Badge size="xs" variant="light" color="primary">SCAN 10:02</Badge>
        <Text size="xs" c="dimmed">214 symbols with a valid frame · 18 actionable rows</Text>
      </Group>
      <Tabs value={tab()} onChange={(next) => setTab(next ?? "overview")}>
        <TabsList>
          <Tab value="overview">OVERVIEW</Tab>
          <Tab value="flow">FLOW</Tab>
          <Tab value="levels">LEVELS</Tab>
          <Tab value="locked" disabled>LOCKED</Tab>
        </TabsList>
        <TabsPanel value="overview" style={{ padding: "12px" }}>
          <List size="sm" withPadding>
            <ListItem>Frame is fresh and session-pinned.</ListItem>
            <ListItem>Universe scanned with no stale rows.</ListItem>
          </List>
        </TabsPanel>
        <TabsPanel value="flow" style={{ padding: "12px" }}>
          <Timeline active={1} bulletSize={14} lineWidth={1}>
            <Timeline.Item title="10:00 · Scan">Universe scanned; 214 symbols had a valid frame.</Timeline.Item>
            <Timeline.Item title="10:01 · Filter">Filters narrowed the list to 18 actionable rows.</Timeline.Item>
            <Timeline.Item title="10:02 · Paper order">Structure previewed and sent to the paper book.</Timeline.Item>
          </Timeline>
        </TabsPanel>
        <TabsPanel value="levels" style={{ padding: "12px" }}>
          <Tree data={treeData} levelOffset={16} />
        </TabsPanel>
      </Tabs>
    </Stack>
  );
};

const DensitySurface = (props: { density: Density }) => {
  const t = DENSITY_TOKENS[props.density];
  return (
    <Box style={{ width: "280px", "flex-shrink": 0, background: palette.SURFACE_ALT, border: `1px solid ${palette.BORDER}` }}>
      <Box style={{ padding: t.tableCellPad, "border-bottom": `1px solid ${palette.BORDER}` }}>
        <Text size="xs" fw={700} c="dimmed" className="font-mono">{props.density} · row {t.tableRowHeight}px</Text>
      </Box>
      <Box style={{ padding: t.tableCellPad }}>
        <Accordion defaultValue="nifty">
          <Accordion.Item value="nifty">
            <Accordion.Control style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>F&O universe</Accordion.Control>
            <Accordion.Panel>
              <Text size="xs" c="dimmed" style={{ padding: t.tableCellPad }}>NIFTY and BANKNIFTY chain roots.</Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Box>
      <Box style={{ padding: t.tableCellPad, "border-top": `1px solid ${palette.BORDER}` }}>
        <Timeline active={1} bulletSize={12} lineWidth={1}>
          <Timeline.Item title="Scan" style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>214 valid frames.</Timeline.Item>
          <Timeline.Item title="Filter" style={{ padding: t.tableCellPad, "min-height": `${t.tableRowHeight}px` }}>18 actionable rows.</Timeline.Item>
        </Timeline>
      </Box>
    </Box>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", margin: "0 auto", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Data display"
          count={components.length}
          purpose="Primitives that make structured data scannable: split a view into tabs, disclose detail in an accordion, order events on a timeline, traverse a tree or expose actions in a menu. They share one spacing and type rhythm with the rest of the terminal."
          specimen={<WorkflowSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Accordion" note="Separated variant keeps each section independently collapsible.">
          <Box style={{ "max-width": "640px" }}>
            <Accordion defaultValue="filters" variant="separated">
              <Accordion.Item value="filters">
                <Accordion.Control>Filters</Accordion.Control>
                <Accordion.Panel><Text size="sm" c="dimmed" style={{ padding: "8px" }}>Sector, cap tier and quality filters live here.</Text></Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="risk">
                <Accordion.Control>Risk controls</Accordion.Control>
                <Accordion.Panel><Text size="sm" c="dimmed" style={{ padding: "8px" }}>Position size, daily loss limit and exposure caps.</Text></Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="execution">
                <Accordion.Control>Execution</Accordion.Control>
                <Accordion.Panel><Text size="sm" c="dimmed" style={{ padding: "8px" }}>Slippage, cooldown and entry timing.</Text></Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Box>
        </Specimen>
        <Specimen title="Menu" note="Target button, grouped items and a destructive action.">
          <MenuSpecimen />
        </Specimen>
        <Specimen title="Density" note="Tree and timeline read the shared DENSITY_TOKENS rhythm at both settings.">
          <Group gap="md" align="flex-start" wrap="wrap">
            <DensitySurface density="compact" />
            <DensitySurface density="comfortable" />
          </Group>
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · per-component pages: <code>src/stories/components/Data display</code>.</Text>
      </Stack>
    )),
};

function MenuSpecimen() {
  const [opened, setOpened] = createSignal(false);
  const [action, setAction] = createSignal("none");
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">Open: {String(opened())} · last action: {action()}</Text>
      <Box style={{ width: "320px" }}>
        <Menu opened={opened()} onChange={setOpened}>
          <MenuTarget><Button variant="outline">Actions</Button></MenuTarget>
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
}
