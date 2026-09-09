import type { Meta, StoryObj } from "@storybook/react-vite";
import { SimpleGrid } from "./SimpleGrid";

const meta: Meta<typeof SimpleGrid> = {
  title: "Primitives/Layout/SimpleGrid",
  component: SimpleGrid,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Grid with equal-width columns via cols prop. Use for quick card grids without Grid.Col nesting. When not to use: for asymmetric layouts use Grid. Uses MUI SimpleGrid with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof SimpleGrid>;

const cells = Array.from({ length: 6 }, (_, i) => (
  <div
    key={i}
    style={{
      background: "var(--mui-palette-primary-light)",
      padding: 16,
      borderRadius: 6,
      textAlign: "center",
    }}
  >
    Cell {i + 1}
  </div>
));

export const FixedCols: Story = {
  render: () => (
    <SimpleGrid cols={3} spacing="md">
      {cells}
    </SimpleGrid>
  ),
};

export const TwoCols: Story = {
  render: () => (
    <SimpleGrid cols={2} spacing="lg" verticalSpacing="lg" style={{ width: 300 }}>
      {cells}
    </SimpleGrid>
  ),
};
