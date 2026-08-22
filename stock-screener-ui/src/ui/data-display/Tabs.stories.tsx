import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text, Title } from "@mantine/core";
import { Tabs, TabsList, Tab, TabsPanel } from "./Tabs";

const meta: Meta<typeof Tabs> = {
  title: "Primitives/Data Display/Tabs",
  component: Tabs,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Default tabs</Title>
      <Tabs defaultValue="positions">
        <TabsList>
          <Tab value="positions">Positions</Tab>
          <Tab value="orders">Orders</Tab>
          <Tab value="history" disabled>History</Tab>
        </TabsList>

        <TabsPanel value="positions">
          <Text size="sm">3 open positions · net P&L +1.24%</Text>
        </TabsPanel>
        <TabsPanel value="orders">
          <Text size="sm">No pending orders.</Text>
        </TabsPanel>
        <TabsPanel value="history" keepMounted>
          <Text size="sm">Trade history is unavailable.</Text>
        </TabsPanel>
      </Tabs>
    </Stack>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stack gap="md">
      <div>
        <Title order={5}>Pills</Title>
        <Tabs defaultValue="a" variant="pills" color="teal">
          <TabsList>
            <Tab value="a">Overview</Tab>
            <Tab value="b">Signals</Tab>
            <Tab value="c">Config</Tab>
          </TabsList>
          <TabsPanel value="a"><Text size="sm">Overview panel</Text></TabsPanel>
          <TabsPanel value="b" keepMounted><Text size="sm">Signals panel</Text></TabsPanel>
          <TabsPanel value="c" keepMounted><Text size="sm">Config panel</Text></TabsPanel>
        </Tabs>
      </div>
      <div>
        <Title order={5}>Outline</Title>
        <Tabs defaultValue="x" variant="outline" color="blue">
          <TabsList>
            <Tab value="x">Chart</Tab>
            <Tab value="y">Depth</Tab>
          </TabsList>
          <TabsPanel value="x"><Text size="sm">Candlestick chart panel</Text></TabsPanel>
          <TabsPanel value="y" keepMounted><Text size="sm">Market depth panel</Text></TabsPanel>
        </Tabs>
      </div>
    </Stack>
  ),
};
