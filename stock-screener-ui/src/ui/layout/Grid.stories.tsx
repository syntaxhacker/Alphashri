import type { Meta, StoryObj } from "@storybook/react-vite";
import { Grid } from "./Grid";

const meta: Meta<typeof Grid> = {
  title: "Design System/Layout/Grid",
  component: Grid,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Grid>;

const cell = (label: string) => (
  <div
    style={{
      background: "var(--mantine-color-blue-light)",
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
