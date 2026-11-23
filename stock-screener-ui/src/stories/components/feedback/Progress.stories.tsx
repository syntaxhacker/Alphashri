import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Progress, Stack, Text } from "@/ui";
import type { UIProgressProps } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen } from "./fixtures";

const colorOptions = ["primary", "success", "error", "danger", "warning", "info", "secondary", "default"];
const sizeOptions = ["xs", "sm", "md", "lg", "xl"];
const radiusOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Feedback/Progress",
  tags: ["autodocs"],
  component: Progress as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Progress is a determinate bar with role=\"progressbar\" and aria-valuemin/max/now. value is clamped to 0–100. color, size, radius, striped, animated, label, transitionDuration and sections (a segmented bar) cover the common states.",
      },
    },
  },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 }, description: "Clamped to 0–100." },
    color: { control: { type: "select" }, options: colorOptions },
    size: { control: { type: "select" }, options: sizeOptions },
    radius: { control: { type: "select" }, options: radiusOptions },
    striped: { control: { type: "boolean" } },
    animated: { control: { type: "boolean" }, description: "Animates the stripes; requires striped." },
    label: { control: { type: "text" }, description: "Centred overlay label." },
    transitionDuration: { control: { type: "number" }, description: "Width transition in ms." },
    sections: { control: false, description: "Segmented bar: value / color / label per section." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { value: 62, color: "primary", size: "sm", label: "62%" },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Progress" note="Determinate completion with an accessible value range. The specimen below reflects the controls above.">
        <Section title="Playground" note="Value is clamped to 0–100; the label is centred over the fill.">
          <Progress {...(args as UIProgressProps)} />
        </Section>
      </Catalog>
    )),
};

export const Values: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Progress — values" note="Frozen values from empty to complete, plus a labelled slider that drives the real prop.">
        <Section title="Determinate values" note="0, 25, 62 and 100 — the bar clamps any value outside 0–100.">
          <Stack gap="md">
            <Text size="xs" c="dimmed">0% — empty</Text>
            <Progress value={0} />
            <Text size="xs" c="dimmed">25% — primary</Text>
            <Progress value={25} />
            <Text size="xs" c="dimmed">62% — with label</Text>
            <Progress value={62} label="62%" />
            <Text size="xs" c="dimmed">100% — complete</Text>
            <Progress value={100} color="success" />
          </Stack>
        </Section>
        <Section title="Interactive value" note="The range input drives the same value prop; its aria-label names the control.">
          {(() => {
            const [value, setValue] = createSignal(45);
            return (
              <Stack gap="md">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={value()}
                  aria-label="Progress value"
                  onInput={(event) => setValue(Number(event.currentTarget.value))}
                />
                <Text size="xs" c="dimmed">value = {value()}</Text>
                <Progress value={value()} label={`${value()}%`} transitionDuration={120} />
              </Stack>
            );
          })()}
        </Section>
      </Catalog>
    )),
};

export const ColorsSizesAndStripes: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Progress — scale" note="Semantic tones, height steps and stripe states on one catalog page.">
        <Section title="Semantic colours" note="success, error/danger, warning and info map to the same tokens used by Badge and Alert.">
          <Stack gap="md">
            {colorOptions.map((color) => (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">{color}</Text>
                <Progress value={70} color={color} />
              </Stack>
            ))}
          </Stack>
        </Section>
        <Section title="Sizes and radius" note="xs 4px → xl 20px tall; radius steps come from the design tokens.">
          <Stack gap="md">
            {sizeOptions.map((size) => <Progress value={55} size={size} />)}
            {radiusOptions.map((radius) => <Progress value={55} radius={radius} color="info" />)}
          </Stack>
        </Section>
        <Section title="Striped and animated" note="animated only changes the stripe motion; it has no effect without striped.">
          <Stack gap="md">
            <Progress value={38} color="warning" striped />
            <Progress value={64} color="info" striped animated label="Syncing 64%" />
          </Stack>
        </Section>
      </Catalog>
    )),
};

export const Sections: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Progress — segments" note="A single bar split into adjacent status segments, with optional per-segment labels.">
        <Section title="Segmented bar" note="sections replaces the single fill with adjacent segments; each can carry its own label.">
          <Stack gap="md">
            <Specimen fill label="three statuses">
              <Progress
                value={100}
                size="md"
                sections={[
                  { value: 50, color: "success", label: "50%" },
                  { value: 30, color: "warning" },
                  { value: 20, color: "error" },
                ]}
              />
            </Specimen>
            <Specimen fill label="striped segments">
              <Progress
                value={100}
                size="sm"
                striped
                sections={[
                  { value: 25, color: "primary" },
                  { value: 25, color: "info" },
                  { value: 50, color: "secondary" },
                ]}
              />
            </Specimen>
          </Stack>
        </Section>
      </Catalog>
    )),
};
