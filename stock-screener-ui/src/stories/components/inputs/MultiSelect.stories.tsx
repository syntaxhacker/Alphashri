import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { MultiSelect, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { FIXTURE_LABEL, SECTORS } from "./fixtures";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface MultiSelectArgs {
  label: string;
  placeholder: string;
  size: "xs" | "sm" | "md";
  searchable: boolean;
  clearable: boolean;
  disabled: boolean;
  error: string;
  description: string;
  maxValues: number;
  hideTags: boolean;
  hidePickedOptions: boolean;
}

const DATA = [...SECTORS];

const meta: Meta<MultiSelectArgs> = {
  title: "Design System/Components/Inputs/MultiSelect",
  component: MultiSelect as unknown as Meta<MultiSelectArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/MultiSelect.tsx — a multi-pick combobox with inline tags in one bordered field. " +
          "`value` is a string[]; `maxValues` caps the selection, `hideTags` moves tag rendering to the " +
          "caller, and `hidePickedOptions` removes already-selected rows from the portalled listbox. " +
          "Sizes are xs 24 / sm 30 / md 34 — the only three steps this control supports.",
      },
    },
  },
  args: {
    label: "Sectors",
    placeholder: "Pick sectors",
    size: "md",
    searchable: false,
    clearable: true,
    disabled: false,
    error: "",
    description: "Frozen sector list; one entry is unavailable",
    maxValues: 4,
    hideTags: false,
    hidePickedOptions: false,
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the combobox input." },
    placeholder: { control: "text", description: "Shown when nothing is selected and tags are visible." },
    size: {
      control: "select",
      options: ["xs", "sm", "md"],
      description: "Minimum field height step; md (34px) is the default.",
    },
    searchable: { control: "boolean", description: "Filters the listbox by label or value." },
    clearable: { control: "boolean", description: "Adds per-tag remove buttons." },
    disabled: { control: "boolean", description: "Disables the field and every option." },
    error: { control: "text", description: "Non-empty string marks the field invalid in the helper slot." },
    description: { control: "text", description: "Helper text used when there is no error." },
    maxValues: { control: "number", description: "Hard cap on the number of selected values." },
    hideTags: { control: "boolean", description: "Suppresses inline tags so the caller can render its own row." },
    hidePickedOptions: { control: "boolean", description: "Hides already-picked options in the listbox." },
  },
};
export default meta;
type Story = StoryObj<MultiSelectArgs>;

/** Controlled selection: the array signal is the only source of truth. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<string[]>(["it", "banks"]);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · MultiSelect props" note={FIXTURE_LABEL} width={640}>
            <Stack gap="sm" style={{ "max-width": "400px" }}>
              <MultiSelect
                label={args.label}
                placeholder={args.placeholder}
                size={args.size}
                searchable={args.searchable}
                clearable={args.clearable}
                disabled={args.disabled}
                error={args.error}
                description={args.description}
                maxValues={args.maxValues}
                hideTags={args.hideTags}
                hidePickedOptions={args.hidePickedOptions}
                data={DATA}
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Selected: ${value().join(", ") || "(none)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Three height steps; tags wrap inside the field without changing its border. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 px minimum height; tags wrap inside the field.">
          <SpecimenGrid cols={2}>
            <MultiSelect size="xs" label="Extra small" data={DATA} defaultValue={["it"]} />
            <MultiSelect size="sm" label="Small" data={DATA} defaultValue={["it", "banks"]} />
            <MultiSelect size="md" label="Medium (default)" data={DATA} defaultValue={["it", "banks", "auto"]} />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Caps and tag rendering: maxValues=2 stops at two picks; hideTags leaves the field bare. */
export const CapsAndTagModes: Story = {
  render: () =>
    solidStory(() => {
      const [capped, setCapped] = createSignal<string[]>(["it", "banks"]);
      return (
        <SpecimenCanvas>
          <Specimen title="Caps & tag modes" note="The field caps the array before onChange fires; hideTags hands rendering to the caller.">
            <SpecimenGrid cols={2}>
              <MultiSelect
                label="At the cap (max 2)"
                data={DATA}
                maxValues={2}
                value={capped()}
                onChange={setCapped}
                description="Try adding a third sector — it is ignored."
              />
              <MultiSelect label="No inline tags" data={DATA} defaultValue={["pharma"]} hideTags description="Caller owns the tag row in this mode." />
              <MultiSelect label="Only unselected options" data={DATA} defaultValue={["it", "banks"]} hidePickedOptions />
            </SpecimenGrid>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Error/disabled states and the no-options edge with a labelled message. */
export const StatesAndEmpty: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Validation & empty states" note="Error, disabled and the no-options edge with a labelled empty message.">
          <SpecimenGrid cols={2}>
            <MultiSelect label="Required sectors" data={DATA} error="Select at least one sector" required placeholder="Pick sectors" />
            <MultiSelect label="Locked sectors" data={DATA} defaultValue={["auto"]} disabled description="Disabled fields cannot be cleared." />
            <MultiSelect label="No sectors available" data={[]} placeholder="Filter first" nothingFoundMessage="No sectors for this filter" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
