import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/ui";
import { DatePicker } from "./DatePicker";

const meta: Meta<typeof DatePicker> = {
  title: "Primitives/Dates/DatePicker",
  component: DatePicker,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Calendar date picker. Use for selecting trade dates, filter ranges, or backtest windows. When not to use: for simple text dates use TextInput. Uses Mantine DatePicker with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof DatePicker>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return (
      <Stack gap="xs" w={280}>
        <DatePicker value={value} onChange={setValue} placeholder="Pick a date" />
        <span style={{ fontSize: 12 }}>
          Selected: {value ? value.toDateString() : "none"}
        </span>
      </Stack>
    );
  },
};

export const WithDefaultValue: Story = {
  args: {
    defaultValue: new Date(),
  },
};

export const Clearable: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return (
      <Stack w={280}>
        <DatePicker value={value} onChange={setValue} clearable placeholder="Clearable date" />
      </Stack>
    );
  },
};

export const WithValueFormat: Story = {
  render: () => {
    const [value, setValue] = useState<Date | null>(null);
    return (
      <Stack gap="xs" w={280}>
        <DatePicker value={value} onChange={setValue} valueFormat="DD MMM YYYY" clearable />
        <span style={{ fontSize: 12 }}>Formatted: {value ? value.toISOString().slice(0, 10) : "—"}</span>
      </Stack>
    );
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap="xs" w={280}>
      <DatePicker size="xs" placeholder="xs" />
      <DatePicker size="sm" placeholder="sm" />
      <DatePicker size="md" placeholder="md" />
      <DatePicker size="lg" placeholder="lg" />
    </Stack>
  ),
};
