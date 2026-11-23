import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Accordion, Box, Button, Menu, Stack, Tabs, Text, Timeline, Tree } from "@/ui";

const meta: Meta = { title: "Design System/Data display", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const TabsExample: Story = {
  render: () =>
    solidStory(() => (
      <Box style={{ width: "620px" }}>
        <Tabs defaultValue="overview">
          <Tabs.List>
            <Tabs.Tab value="overview">OVERVIEW</Tabs.Tab>
            <Tabs.Tab value="flow">FLOW</Tabs.Tab>
            <Tabs.Tab value="levels">LEVELS</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview" style={{ padding: "12px" }}>
            <Text size="sm">Overview panel — market breadth, spot, and the current regime.</Text>
          </Tabs.Panel>
          <Tabs.Panel value="flow" style={{ padding: "12px" }}>
            <Text size="sm">Flow panel — delivery, volume, and participant activity.</Text>
          </Tabs.Panel>
          <Tabs.Panel value="levels" style={{ padding: "12px" }}>
            <Text size="sm">Levels panel — support, resistance, and wall levels.</Text>
          </Tabs.Panel>
        </Tabs>
      </Box>
    )),
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
    solidStory(() => (
      <Box style={{ width: "320px" }}>
        <Menu>
          <Menu.Target>
            <Button variant="outline">Actions</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item>Replay structure</Menu.Item>
            <Menu.Item>Add leg</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="error">Close position</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>
    )),
};

export const DensityStack: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="sm" style={{ width: "560px" }}>
        <Text size="xs" c="dimmed">Tree and accordion inherit the terminal’s compact density; text uses the 9–13px scale.</Text>
        <Box p="sm" style={{ border: "1px solid var(--color-fin-border)" }}>
          <Text size="sm" fw={600}>Nested data surfaces</Text>
          <Text size="xs" c="dimmed">Use Box/Paper around Tree, Timeline, and Menu for consistent padding.</Text>
        </Box>
      </Stack>
    )),
};
