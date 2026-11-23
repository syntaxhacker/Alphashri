import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import {
  Box, Card, Center, Collapse, Divider, Flex, Grid, GridCol, Group, Paper,
  Row, Col, ScrollArea, SimpleGrid, Stack, ToolbarRow,
} from "@/ui";

const meta: Meta = { title: "Design System/Layout", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

const block = (label: string, height = "56px") => (
  <div
    style={{
      height,
      display: "grid",
      "place-items": "center",
      border: "1px solid var(--color-fin-border)",
      background: "var(--color-fin-surface-alt)",
      color: "var(--color-fin-text-muted)",
      "font-family": "ui-monospace, monospace",
      "font-size": "10px",
    }}
  >
    {label}
  </div>
);

export const BoxesAndSurfaces: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "16px", "max-width": "920px" }}>
        <Box p="sm" bg="var(--color-fin-surface-alt)" style={{ border: "1px solid var(--color-fin-border)" }}>
          Box — spacing, background, border and layout props.
        </Box>
        <Paper p="md" shadow="sm">Paper — elevated surface for grouped content.</Paper>
        <Card>Card — bordered terminal surface, default compact padding.</Card>
        <Center h="80px" style={{ background: "var(--color-fin-surface-alt)", border: "1px solid var(--color-fin-border)" }}>
          Center
        </Center>
        <Divider label="divider label" labelPosition="center" />
      </div>
    )),
};

export const FlexAndStack: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "16px", "max-width": "920px" }}>
        <Flex gap="sm" align="center" justify="space-between">
          {block("Flex 1")}
          {block("Flex 2")}
          {block("Flex 3")}
        </Flex>
        <Stack gap="sm">
          {block("Stack 1")}
          {block("Stack 2")}
        </Stack>
        <Group gap="sm">
          {block("Group 1", "32px")}
          {block("Group 2", "32px")}
          {block("Group 3", "32px")}
        </Group>
        <ToolbarRow>
          {block("Toolbar", "30px")}
          {block("row", "30px")}
          {block("content", "30px")}
        </ToolbarRow>
      </div>
    )),
};

export const Grids: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "20px", "max-width": "920px" }}>
        <SimpleGrid cols={3} spacing="sm">
          {block("SimpleGrid 1")}
          {block("SimpleGrid 2")}
          {block("SimpleGrid 3")}
        </SimpleGrid>
        <Grid gutter="sm">
          <GridCol span={4}>{block("GridCol 4")}</GridCol>
          <GridCol span={8}>{block("GridCol 8")}</GridCol>
        </Grid>
        <Row gap="sm" align="center">
          <Col span={6}>{block("Row / Col 6")}</Col>
          <Col span={6}>{block("Row / Col 6")}</Col>
        </Row>
      </div>
    )),
};

export const ScrollAndCollapse: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "16px", width: "420px" }}>
        <ScrollArea h={100} type="auto">
          <div style={{ display: "grid", gap: "6px" }}>
            {Array.from({ length: 12 }, (_, i) => block(`Scroll row ${i + 1}`, "32px"))}
          </div>
        </ScrollArea>
        <Collapse in>
          <Box p="sm" style={{ border: "1px solid var(--color-fin-border)" }}>Collapse content is visible.</Box>
        </Collapse>
      </div>
    )),
};
