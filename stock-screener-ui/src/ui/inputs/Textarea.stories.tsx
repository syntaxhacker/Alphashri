import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@mantine/core";
import { Textarea } from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Design System/UI/Inputs/Textarea",
  component: Textarea,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    label: "Notes",
    placeholder: "Add a note…",
  },
};

export const Autosize: Story = {
  args: {
    label: "Autosize",
    description: "Grows with content, capped at maxRows",
    autosize: true,
    minRows: 2,
    maxRows: 6,
    defaultValue: "Type multiple lines to see it grow.\nLine 2\nLine 3",
  },
};

export const FixedRows: Story = {
  args: {
    label: "Fixed height",
    minRows: 4,
    defaultValue: "A four-row textarea.",
  },
};

export const Disabled: Story = {
  args: { label: "Disabled", value: "Cannot edit", disabled: true },
};
