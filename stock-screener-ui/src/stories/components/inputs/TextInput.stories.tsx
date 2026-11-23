import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Stack, Text, TextInput } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface TextInputArgs {
  label: string;
  placeholder: string;
  description: string;
  error: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  w: number;
}

const meta: Meta<TextInputArgs> = {
  title: "Design System/Components/Inputs/TextInput",
  component: TextInput as unknown as Meta<TextInputArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/TextInput.tsx — the single-line text field of the shared text family. " +
          "`label` produces a real <label htmlFor>; `description` and `error` share the helper slot " +
          "(an error replaces the description and turns the border negative). Sizes run xs 24 … xl 42 px. " +
          "Passing `value` with `onChange` makes it controlled; `w` opts out of the full-width default.",
      },
    },
  },
  args: {
    label: "Symbol",
    placeholder: "Search NSE instruments",
    description: "NSE symbol or instrument key",
    error: "",
    size: "md",
    required: false,
    disabled: false,
    readOnly: false,
    w: 320,
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the native input by htmlFor." },
    placeholder: { control: "text", description: "Placeholder shown while the field is empty." },
    description: { control: "text", description: "Helper text shown when there is no error." },
    error: { control: "text", description: "Non-empty string replaces the description and marks the field invalid." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Field height/type step; md is the default so it aligns with Select.",
    },
    required: { control: "boolean", description: "Adds the native required attribute and a visible asterisk." },
    disabled: { control: "boolean", description: "Non-editable, reduced opacity." },
    readOnly: { control: "boolean", description: "Focusable but not editable." },
    w: { control: "number", description: "Explicit width in px; disables the full-width default." },
  },
};
export default meta;
type Story = StoryObj<TextInputArgs>;

/** Controlled field: the signal is the only source of truth for the typed value. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal("NIFTY");
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · TextInput props" note="The signal is the only source of truth for the typed value." width={640}>
            <Stack gap="sm" style={{ width: `${args.w}px`, "max-width": "100%" }}>
              <TextInput
                label={args.label}
                placeholder={args.placeholder}
                description={args.description}
                error={args.error}
                size={args.size}
                required={args.required}
                disabled={args.disabled}
                readOnly={args.readOnly}
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Value: ${value() || "(empty)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Every size step at once; heights are fixed per step, not per variant. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 · lg 38 · xl 42 px — all five steps of the text family.">
          <SpecimenGrid cols={2}>
            <TextInput size="xs" label="Extra small" placeholder="NIFTY" />
            <TextInput size="sm" label="Small" placeholder="NIFTY" />
            <TextInput size="md" label="Medium (default)" placeholder="NIFTY" />
            <TextInput size="lg" label="Large" placeholder="NIFTY" />
            <TextInput size="xl" label="Extra large" placeholder="NIFTY" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Helper text and validation share one slot; an error string wins. */
export const DescriptionAndError: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Description & error" note="Helper text and validation share one slot; a non-empty error string wins.">
          <SpecimenGrid cols={2}>
            <TextInput label="Instrument key" description="Format: EXCHANGE|SYMBOL" placeholder="NSE_EQ|INE002A01018" />
            <TextInput label="Instrument key" error="Key must include the exchange segment" defaultValue="INE002A01018" />
            <TextInput label="Quantity" error required placeholder="Lots" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Disabled and read-only are distinct: one blocks focus, the other keeps it. */
export const DisabledAndReadOnly: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Disabled & read-only" note="Disabled fields cannot be focused; read-only fields stay focusable.">
          <SpecimenGrid cols={2}>
            <TextInput label="Locked symbol" defaultValue="BANKNIFTY" disabled description="Disabled fields cannot be focused." />
            <TextInput label="Server quantity" defaultValue="75" readOnly description="Read-only fields stay focusable." />
            <TextInput label="Required search" placeholder="Symbol" required />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Sections and explicit width: the field stops being full-width when `w` is set. */
export const AdornmentsAndWidth: Story = {
  render: () =>
    solidStory(() => {
      const [query, setQuery] = createSignal("");
      return (
        <SpecimenCanvas>
          <Specimen title="Adornments & width" note="Sections flank the value; an explicit w opts out of the full-width default.">
            <Stack gap="lg">
              <SpecimenGrid cols={2}>
                <TextInput
                  label="Search instruments"
                  placeholder="Type a symbol"
                  leftSection={<span aria-hidden="true">⌕</span>}
                  rightSection={<span aria-hidden="true" style={{ color: "var(--color-fin-text-muted)" }}>NSE</span>}
                  value={query()}
                  onChange={setQuery}
                  w={260}
                />
                <TextInput label="Narrow field" defaultValue="180px wide" w={180} description="w={180} overrides fullWidth." />
              </SpecimenGrid>
              <Text size="xs" c="dimmed" aria-live="polite">{`Query: ${query() || "(empty)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
