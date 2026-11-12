import { createSignal, Show } from "solid-js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/ui";
import { Collapse } from "./Collapse";

function CollapseDemo() {
  const [open, setOpen] = createSignal(false);
  return (
    <div style={{ width: "320px" }}>
      <Button onClick={() => setOpen((v) => !v)} mb="sm">
        <Show when={open()} fallback="Show content">
          Hide content
        </Show>
      </Button>
      <Collapse in={open()}>
        <div
          style={{
            background: "#80b5ff",
            padding: "16px",
            borderRadius: "8px",
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
  parameters: { docs: { description: { component: "Height-transition collapsible section. Use for expandable filters, accordion-like toggles, or show/hide content. When not to use: for route-level nav use Accordion. Uses the local @/ui Collapse with theme tokens (no hardcoded colors)." } } },
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
      <div style={{ background: "#80b5ff", padding: "16px", borderRadius: "8px" }}>
        Always-open collapse content.
      </div>
    ),
  },
};
