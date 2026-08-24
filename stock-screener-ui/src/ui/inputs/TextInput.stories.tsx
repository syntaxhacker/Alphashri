import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { TextInput } from "./TextInput";

const meta: Meta<typeof TextInput> = {
  title: "Primitives/Inputs/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Single-line text field with label, error, and description. Use for symbol search, names, or free text. When not to use: for numeric input use NumberInput. Uses MUI TextInput with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof TextInput>;

export const Default: Story = {
  args: { placeholder: "Enter text…" },
};

export const WithLabelDescriptionError: Story = {
  render: () => (
    <Stack gap="md" maw={320}>
      <TextInput label="Symbol" description="NSE ticker, e.g. RELIANCE" placeholder="RELIANCE" />
      <TextInput label="Quantity" required placeholder="100" />
      <TextInput label="Email" error="Invalid email address" defaultValue="not-an-email" />
    </Stack>
  ),
};

export const Disabled: Story = {
  args: { label: "Disabled input", value: "Read only", disabled: true },
};

export const Placeholder: Story = {
  args: { label: "Search", placeholder: "Type to search…" },
};
