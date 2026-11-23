import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Slider, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas } from "./specimen";

interface SliderArgs {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  disabled: boolean;
}

const meta: Meta<SliderArgs> = {
  title: "Design System/Components/Inputs/Slider",
  component: Slider as unknown as Meta<SliderArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/RangeSlider.tsx (the Slider export) — a single-value slider implemented as a " +
          "collapsed range whose lower thumb sits at `min`. `value` and `onChange` are required and the " +
          "story keeps them in a signal. Thumbs are role=slider with aria-value* attributes; `label` " +
          "names them and also renders a visible header. `step` snaps keyboard and pointer values; " +
          "`size` is accepted by the prop type but does not change the painted track.",
      },
    },
  },
  args: {
    value: 2,
    min: 0.1,
    max: 10,
    step: 0.1,
    label: "Risk per trade",
    disabled: false,
  },
  argTypes: {
    value: { control: "number", description: "Controlled value of the moving thumb." },
    min: { control: "number", description: "Lower bound (also the fixed thumb position); defaults to 0." },
    max: { control: "number", description: "Upper bound of the domain." },
    step: { control: "number", description: "Snap increment for pointer drags and arrow keys." },
    label: { control: "text", description: "Visible header and accessible name for both slider thumbs." },
    disabled: { control: "boolean", description: "Refuses pointer and keyboard changes." },
  },
};
export default meta;
type Story = StoryObj<SliderArgs>;

/** Controlled single value; dragging and arrow keys both reach the signal. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal(args.value);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Slider props" note="Dragging and arrow keys both reach the signal." width={640}>
            <Stack gap="sm" style={{ "max-width": "420px" }}>
              <Slider
                value={value()}
                onChange={setValue}
                min={args.min}
                max={args.max}
                step={args.step}
                label={args.label}
                disabled={args.disabled}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Risk: ${value().toFixed(1)}%`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Discrete steps and marks: Home/End hit the bounds, arrows snap to step. */
export const SteppedAndMarked: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal(30);
      return (
        <SpecimenCanvas>
          <Specimen title="Steps & marks" note="Home/End hit the bounds; arrow keys snap to step. Marks label the scale." width={640}>
            <Stack gap="sm" style={{ "max-width": "520px" }}>
              <Slider
                value={value()}
                onChange={setValue}
                min={0}
                max={100}
                step={5}
                label="Position size"
                formatValue={(v) => `${v}%`}
                marks={[
                  { value: 0, label: "0%" },
                  { value: 50, label: "50%" },
                  { value: 100, label: "100%" },
                ]}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Allocated: ${value()}%`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Bounds and disabled: the thumb clamps to min/max and a disabled slider keeps its DOM node. */
export const BoundsAndDisabled: Story = {
  render: () =>
    solidStory(() => {
      const [low, setLow] = createSignal(0);
      const [high, setHigh] = createSignal(100);
      const [mid, setMid] = createSignal(50);
      return (
        <SpecimenCanvas>
          <Specimen title="Bounds & disabled" note="The thumb clamps to min/max; a disabled slider keeps its DOM node." width={640}>
            <Stack gap="lg" style={{ "max-width": "520px" }}>
              <Slider value={low()} onChange={setLow} min={0} max={100} label="At minimum" />
              <Slider value={high()} onChange={setHigh} min={0} max={100} label="At maximum" />
              <Slider value={mid()} onChange={setMid} min={0} max={100} label="Disabled at midpoint" disabled />
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Formatted readout: a negative domain with a money formatter and a dense label. */
export const Formatted: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal(-120);
      return (
        <SpecimenCanvas>
          <Specimen title="Formatted readout" note="A negative domain with a signed point formatter." width={640}>
            <Stack gap="sm" style={{ "max-width": "520px" }}>
              <Slider
                value={value()}
                onChange={setValue}
                min={-500}
                max={500}
                step={10}
                label="Stop offset"
                formatValue={(v) => `${v > 0 ? "+" : ""}${v} pts`}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Offset: ${value() > 0 ? "+" : ""}${value()} pts`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
