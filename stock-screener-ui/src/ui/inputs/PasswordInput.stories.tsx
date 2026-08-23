import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { PasswordInput } from "./PasswordInput";

const meta: Meta<typeof PasswordInput> = {
  title: "Primitives/Inputs/PasswordInput",
  component: PasswordInput,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Password field with visibility toggle. Use for authentication forms. When not to use: for plain text use TextInput. Uses Mantine PasswordInput with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof PasswordInput>;

export const Default: Story = {
  args: {
    label: "Password",
    placeholder: "Enter password",
    defaultValue: "s3cret!",
  },
};

export const WithVisibilityToggleLabel: Story = {
  args: {
    label: "API key",
    visibilityToggleButtonLabel: "Toggle key visibility",
    defaultValue: "sk-1234567890abcdef",
  },
};

export const Required: Story = {
  args: {     label: "Password", required: true, placeholder: "Required field" },
};

export const Disabled: Story = {
  args: { label: "Disabled", value: "locked", disabled: true },
};
