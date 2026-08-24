import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@/ui";
import { UnstyledButton } from "./UnstyledButton";

const meta: Meta<typeof UnstyledButton> = {
  title: "Primitives/Inputs/UnstyledButton",
  component: UnstyledButton,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Button with no default styles — fully custom. Use for clickable cards, rows, or custom interactive surfaces. When not to use: for standard actions use Button. Uses MUI UnstyledButton with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof UnstyledButton>;

export const Default: Story = {
  render: () => (
    <UnstyledButton style={{ fontSize: 14, textDecoration: "underline" }}>
      Plain text button
    </UnstyledButton>
  ),
};

export const LinkStyle: Story = {
  render: () => (
    <Group gap="md">
      <UnstyledButton style={{ color: "var(--mui-palette-primary-main)", fontSize: 14 }}>
        View details
      </UnstyledButton>
      <UnstyledButton style={{ color: "var(--mui-palette-error-main)", fontSize: 14 }}>
        Delete
      </UnstyledButton>
    </Group>
  ),
};

export const CardStyle: Story = {
  render: () => (
    <UnstyledButton
      style={{
        borderRadius: 8,
        textAlign: "left",
        padding: 16,
        width: 220,
      }}
    >
      Card-like button
    </UnstyledButton>
  ),
};
