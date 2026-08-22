import type { Meta, StoryObj } from "@storybook/react-vite";
import { Divider } from "./Divider";

const meta: Meta<typeof Divider> = {
  title: "Design System/Layout/Divider",
  component: Divider,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Divider>;

export const Horizontal: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <div>Above</div>
      <Divider style={{ margin: "12px 0" }} />
      <div>Below</div>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <Divider label="Section" labelPosition="left" style={{ margin: "12px 0" }} />
      <Divider label="or" labelPosition="center" style={{ margin: "12px 0" }} />
      <Divider label="end" labelPosition="right" style={{ margin: "12px 0" }} />
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16, height: 60 }}>
      <span>Left</span>
      <Divider orientation="vertical" />
      <span>Right</span>
    </div>
  ),
};
