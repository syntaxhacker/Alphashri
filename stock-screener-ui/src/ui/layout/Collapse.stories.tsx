import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@mantine/core";
import { Collapse } from "./Collapse";

function CollapseDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ width: 320 }}>
      <Button onClick={() => setOpen((v) => !v)} mb="sm">
        {open ? "Hide" : "Show"} content
      </Button>
      <Collapse in={open}>
        <div
          style={{
            background: "var(--mantine-color-blue-light)",
            padding: 16,
            borderRadius: 8,
          }}
        >
          Collapsible content revealed with a height transition.
        </div>
      </Collapse>
    </div>
  );
}

const meta: Meta<typeof Collapse> = {
  title: "Primitives/Layout/Collapse",
  component: Collapse,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Height-transition collapsible section. Use for expandable filters, accordion-like toggles, or show/hide content. When not to use: for route-level nav use Accordion. Uses Mantine Collapse with theme tokens (no hardcoded colors)." } } },
};

export default meta;
type Story = StoryObj<typeof Collapse>;

export const Interactive: Story = {
  render: () => <CollapseDemo />,
};

export const OpenByDefault: Story = {
  args: {
    in: true,
    children: (
      <div style={{ background: "var(--mantine-color-teal-light)", padding: 16, borderRadius: 8 }}>
        Always-open collapse content.
      </div>
    ),
  },
};
