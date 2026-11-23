import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { RingProgress, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const colorOptions = ["primary", "success", "error", "danger", "warning", "info", "secondary", "default"];

const meta: Meta = {
  title: "Design System/Components/Feedback/RingProgress",
  tags: ["autodocs"],
  component: RingProgress as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "RingProgress draws a circular progress arc in SVG. value (0–100) is the simple case; sections replaces it with stacked arcs. size, thickness, roundCaps, color and label control geometry and the centred readout.",
      },
    },
  },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 } },
    color: { control: { type: "select" }, options: colorOptions },
    size: { control: { type: "number" }, description: "Outer diameter in px (default 80)." },
    thickness: { control: { type: "number" }, description: "Stroke width in px (default 8)." },
    roundCaps: { control: { type: "boolean" } },
    label: { control: { type: "text" }, description: "Centred JSX readout." },
    sections: { control: false, description: "Stacked arcs: value / color / tooltip per section." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { value: 72, color: "primary", size: 96, thickness: 10, roundCaps: true, label: "72%" },
  render: (args) =>
    solidStory(() => (
      <Catalog title="RingProgress" note="Determinate progress on a circular track. The controls above drive the specimen below.">
        <Section title="Playground" note="value is clamped to 0–100; label accepts any JSX readout.">
          <Specimen label={`${args.value}% · ${args.color}`}>
            <RingProgress {...args} />
          </Specimen>
        </Section>
      </Catalog>
    )),
};

export const Values: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="RingProgress — values" note="Frozen determinate values and a labelled slider, all on the same ring geometry.">
        <Section title="Determinate values" note="0, 25, 72 and 100 with the value repeated as the centred label.">
          <SpecimenGrid min={180}>
            {[0, 25, 72, 100].map((value) => (
              <Specimen label={`${value}%`}>
                <RingProgress value={value} label={`${value}%`} />
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
        <Section title="Interactive value" note="The labelled range input updates the ring through its value prop.">
          {(() => {
            const [value, setValue] = createSignal(60);
            return (
              <Stack gap="md">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={value()}
                  aria-label="Ring progress value"
                  onInput={(event) => setValue(Number(event.currentTarget.value))}
                />
                <Text size="xs" c="dimmed">value = {value()}</Text>
                <RingProgress value={value()} size={110} thickness={12} roundCaps label={`${value()}%`} color="info" />
              </Stack>
            );
          })()}
        </Section>
      </Catalog>
    )),
};

export const SectionsAndCaps: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="RingProgress — segments" note="Stacked arcs, semantic colours and cap styles across one wide specimen grid.">
        <Section title="Stacked sections" note="sections replaces value/color with multiple arcs that accumulate up to 100.">
          <SpecimenGrid min={240}>
            <Specimen label="72 / 28">
              <RingProgress
                size={120}
                thickness={14}
                label={<Text size="xs" fw={700}>72%</Text>}
                sections={[
                  { value: 72, color: "success" },
                  { value: 28, color: "secondary" },
                ]}
              />
            </Specimen>
            <Specimen label="50 / 25 / 25, round caps">
              <RingProgress
                size={120}
                thickness={12}
                roundCaps
                label={<Text size="xs" fw={700}>MIX</Text>}
                sections={[
                  { value: 50, color: "primary" },
                  { value: 25, color: "warning" },
                  { value: 25, color: "error" },
                ]}
              />
            </Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Colour, size and caps" note="roundCaps switches the SVG stroke-linecap from butt to round.">
          <SpecimenGrid min={160}>
            {colorOptions.map((color) => (
              <Specimen label={color}>
                <RingProgress value={70} color={color} roundCaps label={<Text size="xs">{color}</Text>} />
              </Specimen>
            ))}
            <Specimen label="small 56"><RingProgress value={70} size={56} thickness={4} /></Specimen>
            <Specimen label="large 120"><RingProgress value={70} size={120} thickness={18} /></Specimen>
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};
