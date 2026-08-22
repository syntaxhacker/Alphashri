import type { Meta, StoryObj } from "@storybook/react-vite";
import { Portal } from "./Portal";

const meta: Meta<typeof Portal> = {
  title: "Primitives/Layout/Portal",
  component: Portal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Portal>;

export const DefaultTargetBody: Story = {
  render: () => (
    <Portal>
      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: 16,
          background: "var(--mantine-color-blue-filled)",
          color: "white",
          padding: "8px 16px",
          borderRadius: 8,
        }}
      >
        Rendered into document.body via Portal
      </div>
    </Portal>
  ),
};

export const StringTarget: Story = {
  render: () => (
    <>
      <div id="portal-demo" style={{ border: "1px dashed var(--mantine-color-default-border)", minHeight: 60 }} />
      <Portal target="portal-demo">
        <div style={{ padding: 8 }}>Portaled into #portal-demo by id</div>
      </Portal>
    </>
  ),
};
