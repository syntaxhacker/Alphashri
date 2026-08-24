import type { Meta, StoryObj } from "@storybook/react-vite";
import { Anchor } from "./Anchor";

const meta: Meta<typeof Anchor> = {
  title: "Primitives/Typography/Anchor",
  component: Anchor,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Themed hyperlink with underline and hover states. Use for navigation links and external URLs. When not to use: for button actions use Button or UnstyledButton. Uses MUI Anchor with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Anchor>;

export const DefaultLink: Story = {
  args: { href: "https://example.com", children: "Visit example.com" },
};

export const UnderlineVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24 }}>
      <Anchor href="#" underline="always">
        always
      </Anchor>
      <Anchor href="#" underline="hover">
        hover
      </Anchor>
      <Anchor href="#" underline="never">
        never
      </Anchor>
    </div>
  ),
};

export const ExternalTarget: Story = {
  args: {
    href: "https://example.com",
    target: "_blank",
    c: "blue",
    size: "lg",
    fw: "bold",
    children: "Opens in a new tab",
  },
};
