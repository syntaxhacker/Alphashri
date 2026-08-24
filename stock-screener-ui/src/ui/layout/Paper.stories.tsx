import type { Meta, StoryObj } from "@storybook/react-vite";
import { Paper } from "./Paper";

const meta: Meta<typeof Paper> = {
  title: "Primitives/Layout/Paper",
  component: Paper,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Elevated surface with shadow and border. Use for cards, panels, and sections that need depth. When not to use: for flat inline containers use Box. Uses MUI Paper with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Paper>;

export const ShadowVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((shadow) => (
        <Paper key={shadow} shadow={shadow} p="md" radius="md">
          shadow=&quot;{shadow}&quot;
        </Paper>
      ))}
    </div>
  ),
};

export const RadiusVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((radius) => (
        <Paper key={radius} radius={radius} p="md">
          radius=&quot;{radius}&quot;
        </Paper>
      ))}
    </div>
  ),
};

export const WithBorder: Story = {
  render: () => (
    <Paper p="lg" radius="md" w={280}>
      Elevated paper without border
    </Paper>
  ),
};
