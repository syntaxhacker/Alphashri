import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { SegmentedControl, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { VIEW_MODES } from "./fixtures";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface SegmentedControlArgs {
  value: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  fullWidth: boolean;
}

const DATA = [...VIEW_MODES];

const meta: Meta<SegmentedControlArgs> = {
  title: "Design System/Components/Inputs/SegmentedControl",
  component: SegmentedControl as unknown as Meta<SegmentedControlArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/SegmentedControl.tsx — a view switch, not a filter row: one hairline track with " +
          "an inset filled item. `data` accepts strings or {value,label,disabled}; `value` with `onChange` " +
          "is controlled, `defaultValue` is uncontrolled. Item heights are xs 20 … xl 32 px. The root is " +
          "role=group, so it needs an aria-label when no visible label precedes it. `color` and " +
          "`withItemsBorders` are accepted legacy props and are not painted.",
      },
    },
  },
  args: {
    value: "table",
    size: "md",
    fullWidth: false,
  },
  argTypes: {
    value: { control: "text", description: "Controlled value of the active item." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Item height: xs 20 · sm 22 · md 24 · lg 28 · xl 32 px.",
    },
    fullWidth: { control: "boolean", description: "Stretches the track to the container width." },
  },
};
export default meta;
type Story = StoryObj<SegmentedControlArgs>;

/** Controlled view switch; the group carries an aria-label, not a hidden input. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal(args.value);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · SegmentedControl props" note="A view switch; the group carries an aria-label, not a hidden input." width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <SegmentedControl
                data={DATA}
                value={value()}
                onChange={setValue}
                size={args.size}
                fullWidth={args.fullWidth}
                aria-label="Result view"
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`View: ${value()}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Item height ladder; the track adds a 2px inset on every side. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Item heights" note="xs 20 · sm 22 · md 24 · lg 28 · xl 32 px items; the track adds a 2px inset.">
          <SpecimenGrid cols={2}>
            <SegmentedControl data={DATA} defaultValue="table" size="xs" aria-label="Extra small view" />
            <SegmentedControl data={DATA} defaultValue="table" size="sm" aria-label="Small view" />
            <SegmentedControl data={DATA} defaultValue="table" size="md" aria-label="Medium view" />
            <SegmentedControl data={DATA} defaultValue="table" size="lg" aria-label="Large view" />
            <SegmentedControl data={DATA} defaultValue="table" size="xl" aria-label="Extra large view" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** fullWidth makes the three items share the track evenly. */
export const FullWidth: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Full width" note="The track fills its cell; each item flexes equally.">
          <SpecimenGrid cols={2}>
            <SegmentedControl data={DATA} defaultValue="grid" size="md" fullWidth aria-label="Full width result view" />
            <SegmentedControl data={DATA} defaultValue="grid" size="sm" fullWidth aria-label="Full width compact result view" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Edge states: a disabled item in the data, and no initial selection. */
export const DisabledItemAndNoSelection: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal("table");
      const items = [
        ...DATA,
        { value: "chart", label: "CHART (unavailable)", disabled: true },
      ];
      return (
        <SpecimenCanvas>
          <Specimen title="Disabled item & no selection" note="The disabled item is visible but refuses selection." width={640}>
            <Stack gap="sm" style={{ "max-width": "420px" }}>
              <SegmentedControl data={items} value={value()} onChange={setValue} aria-label="View with disabled option" />
              <Text size="xs" c="dimmed">With no defaultValue on the next track, nothing is pressed.</Text>
              <SegmentedControl data={DATA} aria-label="View with no selection" />
              <Text size="xs" c="dimmed" aria-live="polite">{`Selected: ${value()}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
