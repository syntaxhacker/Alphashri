import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { Select } from "./Select";

const meta: Meta<typeof Select> = {
  title: "Design System/UI/Inputs/Select",
  component: Select,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Select>;

const data = [
  { value: "reliance", label: "Reliance Industries" },
  { value: "tcs", label: "Tata Consultancy Services" },
  { value: "hdfcbank", label: "HDFC Bank" },
  { value: "infy", label: "Infosys" },
];

export const Default: Story = {
  args: {
    data,
    label: "Symbol",
    placeholder: "Pick a symbol",
  },
};

export const Clearable: Story = {
  args: {
    data,
    label: "Symbol",
    placeholder: "Pick a symbol",
    clearable: true,
    defaultValue: "tcs",
  },
};

export const Searchable: Story = {
  args: {
    data,
    label: "Search symbol",
    placeholder: "Type to filter…",
    searchable: true,
    nothingFoundMessage: "No symbols found",
  },
};

export const Disabled: Story = {
  args: { data, label: "Disabled", defaultValue: "infy", disabled: true },
};

export const WithError: Story = {
  args: { data, label: "Symbol", error: "Symbol is required" },
};
