import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Stack, Title, Text } from "@/ui";
import { TradingDatePicker } from "./TradingDatePicker";

const meta: Meta<typeof TradingDatePicker> = {
  title: "Design System/Common/TradingDatePicker",
  component: TradingDatePicker,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TradingDatePicker>;

export const Default: Story = {
  render: () => {
    const [date, setDate] = useState("2026-07-10");
    return (
      <Stack gap="sm" p="md">
        <Title order={5}>Trading Date Picker</Title>
        <Text size="sm" c="dimmed">
          Weekends and trading holidays are disabled. Selected: {date || "(none)"}
        </Text>
        <TradingDatePicker value={date} onChange={setDate} />
      </Stack>
    );
  },
};

export const NoSelection: Story = {
  render: () => {
    const [date, setDate] = useState("");
    return (
      <Stack gap="sm" p="md">
        <Title order={5}>No date selected</Title>
        <Text size="sm" c="dimmed">Clearable picker with no initial value.</Text>
        <TradingDatePicker value={date} onChange={setDate} />
      </Stack>
    );
  },
};

export const Preselected: Story = {
  render: () => {
    const [date, setDate] = useState("2026-07-13");
    return (
      <Stack gap="sm" p="md">
        <Title order={5}>Preselected date (today)</Title>
        <TradingDatePicker value={date} onChange={setDate} />
      </Stack>
    );
  },
};
