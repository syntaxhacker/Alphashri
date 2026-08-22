import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text, Title } from "@mantine/core";
import { Accordion, AccordionItem, AccordionControl, AccordionPanel } from "./Accordion";

const meta: Meta<typeof Accordion> = {
  title: "Primitives/Data Display/Accordion",
  component: Accordion,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Accordion>;

export const Default: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Default accordion</Title>
      <Accordion defaultValue="strategy">
        <AccordionItem value="strategy">
          <AccordionControl>Strategy</AccordionControl>
          <AccordionPanel>
            <Text size="sm">ORB Best · SL 1.0% · TP 1.5% · cooldown 75 min.</Text>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="risk">
          <AccordionControl>Risk management</AccordionControl>
          <AccordionPanel>
            <Text size="sm">Max 1% risk per trade · 20% capital per position.</Text>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="schedule">
          <AccordionControl>Schedule</AccordionControl>
          <AccordionPanel>
            <Text size="sm">Runs 09:15–15:30 IST on trading days.</Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Stack>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stack gap="md">
      <div>
        <Title order={5}>Contained</Title>
        <Accordion variant="contained" defaultValue="item-1">
          <AccordionItem value="item-1">
            <AccordionControl>Contained item</AccordionControl>
            <AccordionPanel><Text size="sm">Contained variant content.</Text></AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>
      <div>
        <Title order={5}>Separated + multiple</Title>
        <Accordion variant="separated" multiple defaultValue={["a"]}>
          <AccordionItem value="a">
            <AccordionControl>Separated A</AccordionControl>
            <AccordionPanel><Text size="sm">Separated variant, open by default.</Text></AccordionPanel>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionControl>Separated B</AccordionControl>
            <AccordionPanel><Text size="sm">Multiple allows several open at once.</Text></AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>
    </Stack>
  ),
};
