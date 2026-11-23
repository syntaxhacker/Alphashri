import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Match, Switch } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Accordion, Badge, Box, Button, DENSITY_TOKENS, Group, List, ListItem,
  Menu, MenuDropdown, MenuItem, MenuTarget, SegmentedControl, Stack, Tab, Tabs, TabsList, TabsPanel, Text, Timeline, Tree,
  type Density,
} from "@/ui";
import { ErrorAlert } from "@/components/common/states";
import { TableEmptyState } from "@/components/common/TableEmptyState";
import { TableLoadingState } from "@/components/common/TableLoadingState";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

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

const components: FamilyComponentRef[] = [
  { id: "design-system-components-data-display-accordion--docs", name: "Accordion", note: "Separated disclosure panels" },
  { id: "design-system-components-data-display-menu--docs", name: "Menu", note: "Action list with target and divider" },
  { id: "design-system-components-data-display-tabs--docs", name: "Tabs", note: "Controlled views with a disabled tab" },
  { id: "design-system-components-data-display-timeline--docs", name: "Timeline", note: "Ordered events with an active step" },
  { id: "design-system-components-data-display-tree--docs", name: "Tree", note: "Hierarchical universe navigator" },
];

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
        <Text size="xs" fw={700} c="dimmed">{props.density === "compact" ? "Compact spacing" : "Comfortable spacing"}</Text>
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

/** One results surface shown in its three real states, switched by a real control. */
const ScanStatesSpecimen = () => {
  const [state, setState] = createSignal("empty");
  return (
    <Stack gap="sm" style={{ "max-width": "640px" }}>
      <SegmentedControl
        aria-label="Scan result state"
        value={state()}
        onChange={setState}
        data={[
          { value: "empty", label: "NO MATCHES" },
          { value: "loading", label: "SCANNING" },
          { value: "error", label: "FEED ERROR" },
        ]}
      />
      <Box style={{ border: `1px solid ${palette.BORDER}`, background: palette.SURFACE, "min-height": "180px" }}>
        <Switch fallback={
          <TableEmptyState
            message="No symbols matched this filter"
            action={<Button size="xs" variant="outline" onClick={() => setState("loading")}>Widen the filter</Button>}
          />
        }>
          <Match when={state() === "loading"}>
            <TableLoadingState message="Scanning the universe" />
          </Match>
          <Match when={state() === "error"}>
            <ErrorAlert
              title="Feed unavailable"
              message="The options chain is temporarily unavailable."
              withRetry
              onRetry={() => setState("loading")}
            />
          </Match>
        </Switch>
      </Box>
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage>
        <FamilyHero
          name="Data display"
          count={components.length}
          caption="scan workflow"
          purpose="Primitives that make structured data scannable: split a view into tabs, disclose detail in an accordion, order events on a timeline, traverse a tree or expose actions in a menu. They share one spacing and type rhythm with the rest of the terminal."
          specimen={<WorkflowSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="Accordion" note="Separated variant keeps each section independently collapsible.">
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
        </SpecimenPanel>
        <SpecimenPanel title="Menu" note="Target button, grouped items and a destructive action.">
          <MenuSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Density" note="Tree and timeline read the shared spacing rhythm at both settings.">
          <Group gap="md" align="flex-start" wrap="wrap">
            <DensitySurface density="compact" />
            <DensitySurface density="comfortable" />
          </Group>
        </SpecimenPanel>
        <SpecimenPanel title="Result states" note="The scan results surface shown empty, while scanning and when the feed fails; switch states to compare the copy.">
          <ScanStatesSpecimen />
        </SpecimenPanel>
        <FamilyFooter source="src/ui" pages="src/stories/components/data-display" />
      </FamilyPage>
    )),
};

function MenuSpecimen() {
  const [opened, setOpened] = createSignal(false);
  const [action, setAction] = createSignal<string | null>(null);
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">{action() ? `Last action: ${action()}` : "Choose an action from the menu."}</Text>
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
