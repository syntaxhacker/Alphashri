import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Stack, Switch, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface SwitchArgs {
  label: string;
  description: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color: "primary" | "success" | "error" | "warning" | "info" | "secondary";
  disabled: boolean;
  error: boolean;
  checked: boolean;
}

const meta: Meta<SwitchArgs> = {
  title: "Design System/Components/Inputs/Switch",
  component: Switch as unknown as Meta<SwitchArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Switch.tsx — a track with a knob, not a checked square. The knob travel is " +
          "derived from each size's track box (xs 26×14 … md 36×20). `checked` with `onChange` makes it " +
          "controlled; the event's currentTarget.checked is the new value. `color` tints the on-track, " +
          "`error` turns the frame negative. A visible `label` (or an aria-label) is mandatory for icon-less use.",
      },
    },
  },
  args: {
    label: "Live quotes",
    description: "Stream SSE prices during market hours",
    size: "md",
    color: "primary",
    disabled: false,
    error: false,
    checked: true,
  },
  argTypes: {
    label: { control: "text", description: "Visible label rendered beside the track." },
    description: { control: "text", description: "Secondary line under the label." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Track geometry step; xs 26×14, sm 30×16, md/lg/xl 36×20.",
    },
    color: {
      control: "select",
      options: ["primary", "success", "error", "warning", "info", "secondary"],
      description: "Track tone while on, and the focus ring tone.",
    },
    disabled: { control: "boolean", description: "Overrides the fill and keeps the knob in its state position." },
    error: { control: "boolean", description: "Negative frame to indicate a validation failure." },
    checked: { control: "boolean", description: "Controlled on/off state." },
  },
};
export default meta;
type Story = StoryObj<SwitchArgs>;

/** Controlled switch: the signal follows the native checkbox event. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [checked, setChecked] = createSignal(args.checked);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Switch props" note="The signal follows the checked value." width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <Switch
                label={args.label}
                description={args.description}
                size={args.size}
                color={args.color}
                disabled={args.disabled}
                error={args.error}
                checked={checked()}
                onChange={setChecked}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Streaming: ${checked() ? "on" : "off"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Track sizes; lg and xl share the largest box with md. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Track sizes" note="xs 26×14 · sm 30×16 · md/lg/xl 36×20 px.">
          <SpecimenGrid cols={2}>
            <Switch size="xs" label="Extra small" defaultChecked />
            <Switch size="sm" label="Small" defaultChecked />
            <Switch size="md" label="Medium (default)" defaultChecked />
            <Switch size="lg" label="Large" defaultChecked />
            <Switch size="xl" label="Extra large" defaultChecked />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Named tones tint the on-track and the focus ring, not just the label. */
export const Colors: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Semantic colours" note="Named tones tint the on-track and the focus ring.">
          <SpecimenGrid cols={3}>
            <Switch color="primary" label="Primary" defaultChecked />
            <Switch color="success" label="Success" defaultChecked />
            <Switch color="error" label="Error" defaultChecked />
            <Switch color="warning" label="Warning" defaultChecked />
            <Switch color="info" label="Info" defaultChecked />
            <Switch color="secondary" label="Secondary" defaultChecked />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** On/off, disabled and error states; disabled state is readable from knob position. */
export const States: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="States" note="Position, not colour, carries the state when a control is disabled.">
          <SpecimenGrid cols={2}>
            <Switch label="On" defaultChecked />
            <Switch label="Off" />
            <Switch label="Disabled on" defaultChecked disabled />
            <Switch label="Disabled off" disabled />
            <Switch label="Validation error" error defaultChecked description="Required before saving." />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
