import type { Meta, StoryObj } from "@storybook/react-vite";
import { Portal } from "./Portal";

const meta: Meta<typeof Portal> = {
  title: "Primitives/Layout/Portal",
  component: Portal,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Renders children at document body. Use for dropdowns, modals, and overlays that must escape parent overflow. When not to use: regular layout content. Uses MUI Portal with theme tokens (no hardcoded colors)." } } },
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
          background: "var(--mui-palette-primary-main)",
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
      <div id="portal-demo" style={{ border: "1px dashed var(--mui-palette-divider)", minHeight: 60 }} />
      <Portal target="portal-demo">
        <div style={{ padding: 8 }}>Portaled into #portal-demo by id</div>
      </Portal>
    </>
  ),
};
