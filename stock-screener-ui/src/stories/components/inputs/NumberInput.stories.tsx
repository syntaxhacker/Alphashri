import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Stack, Text, NumberInput } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface NumberInputArgs {
  label: string;
  min: number;
  max: number;
  step: number;
  decimalScale: number;
  clampBehavior: "strict" | "blur" | "none";
  size: "xs" | "sm" | "md" | "lg" | "xl";
  disabled: boolean;
  error: string;
  description: string;
}

const meta: Meta<NumberInputArgs> = {
  title: "Design System/Components/Inputs/NumberInput",
  component: NumberInput as unknown as Meta<NumberInputArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/NumberInput.tsx — the numeric member of the text family. Custom steppers " +
          "obey min/max; `clampBehavior` chooses strict (each keystroke), blur (commit) or none. " +
          "`decimalScale`, `allowDecimal` and `allowNegative` are promises about accepted input, so " +
          "forbidden characters are dropped before `onChange` fires. `loading` is a legacy prop and " +
          "is intentionally not painted by this component.",
      },
    },
  },
  args: {
    label: "Quantity (lots)",
    min: 1,
    max: 5000,
    step: 1,
    decimalScale: 0,
    clampBehavior: "blur",
    size: "md",
    disabled: false,
    error: "",
    description: "Steppers clamp to 1–5000",
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the native number input." },
    min: { control: "number", description: "Lower bound used by steppers and by clamping." },
    max: { control: "number", description: "Upper bound used by steppers and by clamping." },
    step: { control: "number", description: "Increment for the custom stepper buttons." },
    decimalScale: { control: "number", description: "Digits kept after the decimal point on commit." },
    clampBehavior: {
      control: "select",
      options: ["strict", "blur", "none"],
      description: "When out-of-range values are clamped: per keystroke, on blur, or never.",
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Field height/type step shared with TextInput.",
    },
    disabled: { control: "boolean", description: "Disables input and both steppers." },
    error: { control: "text", description: "Non-empty string marks the field invalid in the helper slot." },
    description: { control: "text", description: "Helper text used when there is no error." },
  },
};
export default meta;
type Story = StoryObj<NumberInputArgs>;

/** Controlled value: clicking a stepper or typing routes through the same setter. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<number | string>(75);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · NumberInput props" note="Steppers and typing route through the same controlled setter." width={640}>
            <Stack gap="sm" style={{ "max-width": "320px" }}>
              <NumberInput
                label={args.label}
                min={args.min}
                max={args.max}
                step={args.step}
                decimalScale={args.decimalScale}
                clampBehavior={args.clampBehavior}
                size={args.size}
                disabled={args.disabled}
                error={args.error}
                description={args.description}
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Value: ${value() === "" ? "(empty)" : value()}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** The same field at every height step; md aligns with Select in a control row. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 · lg 38 · xl 42 px — md aligns with Select.">
          <SpecimenGrid cols={2}>
            <NumberInput size="xs" label="Extra small" defaultValue={1} min={0} max={10} />
            <NumberInput size="sm" label="Small" defaultValue={10} min={0} max={100} />
            <NumberInput size="md" label="Medium (default)" defaultValue={75} min={0} max={500} />
            <NumberInput size="lg" label="Large" defaultValue={100} min={0} max={1000} />
            <NumberInput size="xl" label="Extra large" defaultValue={250} min={0} max={1000} />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Steppers are the numeric affordance; hideControls turns the field back into text-like input. */
export const BoundsAndSteppers: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Bounds & steppers" note="Steppers obey min/max; hideControls removes both buttons.">
          <SpecimenGrid cols={2}>
            <NumberInput label="Risk %" defaultValue={2} min={0.1} max={10} step={0.1} decimalScale={1} suffix="%" description="Strict clamp, one decimal." />
            <NumberInput label="Entry price" defaultValue={23450.85} min={0} max={100000} step={0.05} decimalScale={2} prefix="₹" description="Money field with a prefix." />
            <NumberInput label="Lots (no steppers)" defaultValue={75} min={1} max={5000} hideControls description="hideControls removes both stepper buttons." />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Input promises and clamping modes: forbidden characters are dropped before emit. */
export const Constraints: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Constraints" note="Input promises and clamp modes; forbidden characters are dropped before onChange fires.">
          <SpecimenGrid cols={2}>
            <NumberInput
              label="Strict clamped %"
              defaultValue={2}
              min={0}
              max={100}
              step={5}
              clampBehavior="strict"
              allowNegative={false}
              allowDecimal={false}
              suffix="%"
              description="Negatives and dots are stripped; typing is clamped immediately."
            />
            <NumberInput
              label="Signed P&L"
              defaultValue={-120.5}
              min={-1000}
              max={1000}
              decimalScale={2}
              clampBehavior="blur"
              prefix="₹"
              description="allowNegative and allowDecimal default to true; clamping waits for blur."
            />
            <NumberInput
              label="Unclamped raw value"
              defaultValue={-5}
              min={0}
              max={100}
              clampBehavior="none"
              description="clampBehavior=none leaves keystrokes alone; steppers still respect bounds."
            />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Error, disabled and required states share the text-family helper slot. */
export const States: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="States" note="Error, disabled and required states share the text-family helper slot.">
          <SpecimenGrid cols={2}>
            <NumberInput label="Quantity" error="Quantity must be at least 1" defaultValue={0} min={1} max={5000} />
            <NumberInput label="Locked quantity" defaultValue={75} disabled description="Steppers are disabled too." />
            <NumberInput label="Required quantity" required placeholder="Lots" min={1} max={5000} />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
