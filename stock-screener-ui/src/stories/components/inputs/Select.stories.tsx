import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Select, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { FIXTURE_LABEL, INSTRUMENTS } from "./fixtures";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface SelectArgs {
  label: string;
  placeholder: string;
  size: "xs" | "sm" | "md";
  searchable: boolean;
  clearable: boolean;
  disabled: boolean;
  error: string;
  description: string;
  value: string | null;
}

const DATA = [...INSTRUMENTS];
const SIMPLE_DATA = DATA.map((option) => option.value);

const meta: Meta<SelectArgs> = {
  title: "Design System/Components/Inputs/Select",
  component: Select as unknown as Meta<SelectArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Select.tsx — a native <select> at its core, with a portalled combobox when " +
          "`searchable` is set. Options come from `data` (strings or {value,label,disabled,group}); " +
          "consecutive `group` values become <optgroup>. Sizes are xs 24 / sm 30 / md 34 — there is " +
          "no lg/xl step for this control. `onChange` emits null for the empty/deselected option.",
      },
    },
  },
  args: {
    label: "Universe",
    placeholder: "Pick a universe",
    size: "md",
    searchable: false,
    clearable: false,
    disabled: false,
    error: "",
    description: "Frozen instruments from the 2026-11-20 session",
    value: "nifty50",
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the native select / combobox." },
    placeholder: { control: "text", description: "Disabled empty option shown until a value is chosen." },
    size: {
      control: "select",
      options: ["xs", "sm", "md"],
      description: "Field height step; md (34px) is the default.",
    },
    searchable: { control: "boolean", description: "Switches to a filterable portalled combobox." },
    clearable: { control: "boolean", description: "Adds a clear button that emits null." },
    disabled: { control: "boolean", description: "Disables the select or combobox input." },
    error: { control: "text", description: "Non-empty string marks the field invalid in the helper slot." },
    description: { control: "text", description: "Helper text used when there is no error." },
    value: { control: "text", description: "Controlled option value (null means no selection)." },
  },
};
export default meta;
type Story = StoryObj<SelectArgs>;

/** Controlled selection from the frozen labelled instrument set. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<string | null>(args.value);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Select props" note={FIXTURE_LABEL} width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <Select
                label={args.label}
                placeholder={args.placeholder}
                size={args.size}
                searchable={args.searchable}
                clearable={args.clearable}
                disabled={args.disabled}
                error={args.error}
                description={args.description}
                data={DATA}
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Selected: ${value() ?? "(none)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Three steps only: the control shares the lower half of the text-field scale. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 px — Select has no lg/xl step.">
          <SpecimenGrid cols={3}>
            <Select size="xs" label="Extra small" data={SIMPLE_DATA} defaultValue="nifty50" />
            <Select size="sm" label="Small" data={SIMPLE_DATA} defaultValue="banknifty" />
            <Select size="md" label="Medium (default)" data={SIMPLE_DATA} defaultValue="reliance" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Searchable uses the portalled listbox; clearable emits null through onChange. */
export const SearchableAndClearable: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<string | null>("infy");
      return (
        <SpecimenCanvas>
          <Specimen title="Searchable & clearable" note={`${FIXTURE_LABEL} · grouped options.`} width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <Select
                label="Searchable universe"
                placeholder="Type to filter"
                searchable
                clearable
                data={DATA}
                nothingFoundMessage="No matching instrument"
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Selected: ${value() ?? "(none)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Validation, disabled state and the empty-options edge with an explicit message. */
export const StatesAndEmpty: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Validation & empty states" note="Required, disabled and the no-options edge with a labelled empty message.">
          <SpecimenGrid cols={2}>
            <Select label="Required universe" placeholder="Pick a universe" data={DATA} error="Choose a universe" required />
            <Select label="Locked universe" data={DATA} defaultValue="nifty50" disabled description="Disabled fields keep their selected label." />
            <Select label="No matching instruments" data={[]} placeholder="Filter first" nothingFoundMessage="No instruments for this filter" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
