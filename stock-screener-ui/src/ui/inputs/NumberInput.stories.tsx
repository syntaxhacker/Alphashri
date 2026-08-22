import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { NumberInput } from "./NumberInput";

const meta: Meta<typeof NumberInput> = {
  title: "Design System/UI/Inputs/NumberInput",
  component: NumberInput,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  args: { label: "Quantity", placeholder: "0" },
};

export const MinMaxStep: Story = {
  args: {
    label: "Quantity",
    description: "Min 1, max 1000, step 10",
    defaultValue: 100,
    min: 1,
    max: 1000,
    step: 10,
    clampBehavior: "strict",
  },
};

export const WithSuffixPrefix: Story = {
  render: () => (
    <Stack gap="md" w={280}>
      <NumberInput label="Price" suffix=" ₹" decimalScale={2} defaultValue={1345.5} />
      <NumberInput label="Percentage" suffix="%" min={-100} max={100} allowNegative defaultValue={2.5} />
    </Stack>
  ),
};

export const Disabled: Story = {
  args: { label: "Disabled", value: 42, disabled: true },
};
