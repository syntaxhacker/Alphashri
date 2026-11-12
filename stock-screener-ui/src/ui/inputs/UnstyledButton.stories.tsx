import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@/ui";
import { UnstyledButton } from "./UnstyledButton";

const meta: Meta<typeof UnstyledButton> = {
  title: "Primitives/Inputs/UnstyledButton",
  component: UnstyledButton,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Button with no default styles — fully custom. Use for clickable cards, rows, or custom interactive surfaces. When not to use: for standard actions use Button. Uses the local @/ui UnstyledButton with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof UnstyledButton>;

export const Default: Story = {
  render: () => (
    <UnstyledButton style={{ "font-size": 14, "text-decoration": "underline" }}>
      Plain text button
    </UnstyledButton>
  ),
};

export const LinkStyle: Story = {
  render: () => (
    <Group gap="md">
      <UnstyledButton style={{ color: "var(--color-fin-primary)", "font-size": 14 }}>
        View details
      </UnstyledButton>
      <UnstyledButton style={{ color: "var(--color-fin-negative)", "font-size": 14 }}>
        Delete
      </UnstyledButton>
    </Group>
  ),
};

export const CardStyle: Story = {
  render: () => (
    <UnstyledButton
      style={{
        "border-radius": 8,
        "text-align": "left",
        padding: 16,
        width: 220,
      }}
    >
      Card-like button
    </UnstyledButton>
  ),
};
