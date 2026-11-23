import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Checkbox, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface CheckboxArgs {
  label: string;
  description: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color: "primary" | "success" | "error" | "warning" | "info" | "secondary";
  indeterminate: boolean;
  disabled: boolean;
  error: boolean;
  checked: boolean;
}

const meta: Meta<CheckboxArgs> = {
  title: "Design System/Components/Inputs/Checkbox",
  component: Checkbox as unknown as Meta<CheckboxArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Checkbox.tsx — a native checkbox with a painted box. `indeterminate` is synced " +
          "as a DOM property, not an attribute, and renders a dash. `checked` with `onChange` is controlled; " +
          "the event's currentTarget.checked is the new value. Box sizes are xs 14 / sm–md 16 / lg–xl 18 px, " +
          "and `color` tints the checked fill and frame together.",
      },
    },
  },
  args: {
    label: "Include expired instruments",
    description: "Show series that stopped trading",
    size: "md",
    color: "primary",
    indeterminate: false,
    disabled: false,
    error: false,
    checked: true,
  },
  argTypes: {
    label: { control: "text", description: "Visible label beside the painted box." },
    description: { control: "text", description: "Secondary line under the label." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Box side: xs 14, sm/md 16, lg/xl 18 px.",
    },
    color: {
      control: "select",
      options: ["primary", "success", "error", "warning", "info", "secondary"],
      description: "Tone of the checked fill and its frame.",
    },
    indeterminate: { control: "boolean", description: "Mixed state; rendered as a dash and set as a DOM property." },
    disabled: { control: "boolean", description: "Non-interactive, reduced opacity." },
    error: { control: "boolean", description: "Negative frame for validation failures." },
    checked: { control: "boolean", description: "Controlled checked state." },
  },
};
export default meta;
type Story = StoryObj<CheckboxArgs>;

/** Controlled checkbox with a live readout of the emitted state. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [checked, setChecked] = createSignal(args.checked);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Checkbox props" note="The signal follows the checked value." width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <Checkbox
                label={args.label}
                description={args.description}
                size={args.size}
                color={args.color}
                indeterminate={args.indeterminate}
                disabled={args.disabled}
                error={args.error}
                checked={checked()}
                onChange={setChecked}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Checked: ${checked() ? "yes" : "no"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Box sizes; sm and md, and lg and xl, intentionally share a side. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Box sizes" note="xs 14 · sm/md 16 · lg/xl 18 px — adjacent steps intentionally share a side.">
          <SpecimenGrid cols={2}>
            <Checkbox size="xs" label="Extra small" defaultChecked />
            <Checkbox size="sm" label="Small" defaultChecked />
            <Checkbox size="md" label="Medium (default)" defaultChecked />
            <Checkbox size="lg" label="Large" defaultChecked />
            <Checkbox size="xl" label="Extra large" defaultChecked />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Named tones on the fill; unchecked boxes stay a neutral hairline. */
export const Colors: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Semantic colours" note="Named tones tint the checked fill and frame; unchecked boxes stay neutral.">
          <SpecimenGrid cols={3}>
            <Checkbox color="primary" label="Primary" defaultChecked />
            <Checkbox color="success" label="Success" defaultChecked />
            <Checkbox color="error" label="Error" defaultChecked />
            <Checkbox color="warning" label="Warning" defaultChecked />
            <Checkbox color="info" label="Info" defaultChecked />
            <Checkbox color="secondary" label="Secondary" defaultChecked />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Mixed and invalid states: a dash, a negative frame, and a disabled pair. */
export const MixedAndStates: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Mixed & validation states" note="A parent with a partial group renders a dash; error and disabled are distinct.">
          <SpecimenGrid cols={2}>
            <Checkbox label="All sectors" indeterminate description="2 of 4 selected" />
            <Checkbox label="Valid selection" checked defaultChecked />
            <Checkbox label="Validation error" error />
            <Checkbox label="Disabled checked" checked defaultChecked disabled />
            <Checkbox label="Disabled unchecked" disabled />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
