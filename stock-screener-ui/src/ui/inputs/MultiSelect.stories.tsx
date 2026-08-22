import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { MultiSelect } from "./MultiSelect";

const meta: Meta<typeof MultiSelect> = {
  title: "Primitives/Inputs/MultiSelect",
  component: MultiSelect,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MultiSelect>;

const data = [
  { value: "orb", label: "ORB Best" },
  { value: "sr", label: "SR Breakout" },
  { value: "chaser", label: "52W Chaser" },
  { value: "ema", label: "EMA Cross" },
];

export const Default: Story = {
  args: {
    data,
    label: "Strategies",
    placeholder: "Pick strategies",
  },
};

export const WithDefaults: Story = {
  args: {
    data,
    label: "Strategies",
    description: "Pre-selected values",
    defaultValue: ["orb", "sr"],
    clearable: true,
  },
};

export const Searchable: Story = {
  args: {
    data,
    label: "Search strategies",
    searchable: true,
    nothingFoundMessage: "Nothing found",
    placeholder: "Type to filter…",
  },
};

export const MaxValues: Story = {
  args: { data, label: "Max 2", maxValues: 2, defaultValue: ["orb", "ema"] },
};

export const Disabled: Story = {
  args: { data, label: "Disabled", defaultValue: ["chaser"], disabled: true },
};
