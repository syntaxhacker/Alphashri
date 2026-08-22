import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group } from "@mantine/core";
import { UnstyledButton } from "./UnstyledButton";

const meta: Meta<typeof UnstyledButton> = {
  title: "Design System/UI/Inputs/UnstyledButton",
  component: UnstyledButton,
  tags: ["autodocs"],
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
      <UnstyledButton style={{ color: "var(--mantine-color-blue-6)", fontSize: 14 }}>
        View details
      </UnstyledButton>
      <UnstyledButton style={{ color: "var(--mantine-color-red-6)", fontSize: 14 }}>
        Delete
      </UnstyledButton>
    </Group>
  ),
};

export const CardStyle: Story = {
  render: () => (
    <UnstyledButton
      style={{
        border: "1px solid var(--mantine-color-default-border)",
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
