import type { Meta, StoryObj } from "@storybook/react-vite";
import { Grid } from "./Grid";

const meta: Meta<typeof Grid> = {
  title: "Primitives/Layout/Grid",
  component: Grid,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "12-column responsive grid. Use for dashboard layouts and card grids that must reflow at breakpoints. When not to use: for single-axis stacks use Stack or Flex. Uses MUI Grid with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Grid>;

const cell = (label: string) => (
  <div
    style={{
      background: "var(--mui-palette-primary-light)",
      padding: 16,
      borderRadius: 6,
      textAlign: "center",
    }}
  >
    {label}
  </div>
);

export const SpannedColumns: Story = {
  render: () => (
    <Grid gutter="md">
      <Grid.Col span={8}>{cell("span=8")}</Grid.Col>
      <Grid.Col span={4}>{cell("span=4")}</Grid.Col>
      <Grid.Col span={6}>{cell("span=6")}</Grid.Col>
      <Grid.Col span={6}>{cell("span=6")}</Grid.Col>
    </Grid>
  ),
};

export const WithGutter: Story = {
  render: () => (
    <Grid gutter="lg">
      <Grid.Col span={4}>{cell("1")}</Grid.Col>
      <Grid.Col span={4}>{cell("2")}</Grid.Col>
      <Grid.Col span={4}>{cell("3")}</Grid.Col>
    </Grid>
  ),
};
