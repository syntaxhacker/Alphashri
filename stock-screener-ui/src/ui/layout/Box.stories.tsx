import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "./Box";

const meta: Meta<typeof Box> = {
  title: "Primitives/Layout/Box",
  component: Box,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Polymorphic container — the base of every Mantine component. Use for any Box-model layout (p, m, bg) that doesn't need a semantic wrapper. When not to use: prefer Stack/Group/Flex for flex layouts. Uses Mantine Box with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Box>;

export const BackgroundPadding: Story = {
  render: () => (
    <Box bg="blue" p="md" c="white" w={200}>
      bg + padding via props
    </Box>
  ),
};

export const InlineStyle: Story = {
  render: () => (
    <Box style={{ background: "var(--mantine-color-teal-filled)", padding: 16, borderRadius: 8 }}>
      styled via style prop
    </Box>
  ),
};

export const Dimensions: Story = {
  render: () => (
    <Box bg="grape" c="white" p="sm" mih={80} style={{ display: "grid", placeItems: "center" }}>
      fixed height box
    </Box>
  ),
};
