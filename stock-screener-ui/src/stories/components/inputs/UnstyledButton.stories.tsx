import type { Meta, StoryObj } from "@storybook/html-vite";
import { Group, Stack, Text, UnstyledButton } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas } from "./specimen";

interface UnstyledButtonArgs {
  children: string;
  className: string;
}

const meta: Meta<UnstyledButtonArgs> = {
  title: "Design System/Components/Inputs/UnstyledButton",
  component: UnstyledButton as unknown as Meta<UnstyledButtonArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/UnstyledButton.tsx — a bare semantic <button> with no treatment at all: only " +
          "children, className, style, id, data-testid and onClick are forwarded. It has no variant, " +
          "size, colour, disabled or loading props; every visual state belongs to the caller. Visible " +
          "text is the label — this component does not forward aria-* attributes.",
      },
    },
  },
  args: {
    children: "Rerun screen",
    className: "text-fin-primary underline",
  },
  argTypes: {
    children: { control: "text", description: "Visible label; the only accessible name this control exposes." },
    className: { control: "text", description: "Caller-supplied Tailwind classes — the entire visual treatment." },
  },
};
export default meta;
type Story = StoryObj<UnstyledButtonArgs>;

/** Controls-driven text action; the class string comes from the real className prop. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Playground · UnstyledButton" note="No built-in treatment: className is the whole design." width={640}>
          <Stack gap="xs" style={{ "max-width": "320px" }}>
            <UnstyledButton className={args.className}>{args.children}</UnstyledButton>
            <Text size="xs" c="dimmed">The visible text is the only accessible name.</Text>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** A row of text-only actions: the escape hatch for bespoke inline controls. */
export const TextActions: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Text actions" note="Each action has visible text; spacing comes from the layout Group.">
          <Group gap="lg" align="center" wrap="wrap">
            <UnstyledButton className="text-fin-primary underline">Edit filter</UnstyledButton>
            <UnstyledButton className="text-fin-text-muted">Reset</UnstyledButton>
            <UnstyledButton className="text-fin-negative">Clear all</UnstyledButton>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** style is forwarded verbatim; colours stay on CSS variables from the single palette. */
export const CallerSuppliedStyles: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Caller-supplied styles" note="The caller paints the control — theme CSS variables only, no hex literals.">
          <Group gap="lg" align="center" wrap="wrap">
            <UnstyledButton className="text-ui-micro" style={{ color: "var(--color-fin-primary)", "font-weight": "600" }}>
              Primary link action
            </UnstyledButton>
            <UnstyledButton className="text-ui-micro" style={{ color: "var(--color-fin-positive)" }}>
              Positive action
            </UnstyledButton>
            <UnstyledButton className="text-ui-micro" style={{ color: "var(--color-fin-text-muted)" }}>
              Muted (visual only — no disabled prop exists)
            </UnstyledButton>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Long labels and empty labels are caller concerns; the wrapper never clips or pads. */
export const EdgeLabels: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Edge labels" note="A long label wraps with the caller’s classes; there is no built-in truncation." width={640}>
          <Stack gap="xs" style={{ "max-width": "360px" }}>
            <UnstyledButton className="text-left text-xs text-fin-text">
              Export the full 2026-11-20 index quote snapshot as CSV
            </UnstyledButton>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};
