import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { RangeSlider, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas } from "./specimen";

interface RangeSliderArgs {
  min: number;
  max: number;
  step: number;
  label: string;
  disabled: boolean;
  hideHeader: boolean;
  commitOnRelease: boolean;
}

const meta: Meta<RangeSliderArgs> = {
  title: "Design System/Components/Inputs/RangeSlider",
  component: RangeSlider as unknown as Meta<RangeSliderArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/RangeSlider.tsx — two role=slider thumbs on one track, with a filled span " +
          "between them. `value` is a [number, number] tuple; the component clamps and orders it before " +
          "painting and before emitting. `hideHeader` keeps the label for aria only, `commitOnRelease` " +
          "previews locally and emits once on pointer-up, and `marks` adds a labelled scale. `size` is " +
          "accepted by the prop type but does not change the painted track.",
      },
    },
  },
  args: {
    min: 0,
    max: 100,
    step: 1,
    label: "Target band",
    disabled: false,
    hideHeader: false,
    commitOnRelease: false,
  },
  argTypes: {
    min: { control: "number", description: "Lower bound of the domain; defaults to 0." },
    max: { control: "number", description: "Upper bound of the domain." },
    step: { control: "number", description: "Snap increment for pointer drags and arrow keys." },
    label: { control: "text", description: "Visible header and base name for both thumbs." },
    disabled: { control: "boolean", description: "Refuses pointer and keyboard changes." },
    hideHeader: { control: "boolean", description: "Keeps the label for aria but removes the visible header." },
    commitOnRelease: { control: "boolean", description: "Emit once on pointer-up instead of on every move." },
  },
};
export default meta;
type Story = StoryObj<RangeSliderArgs>;

/** Controlled tuple: both thumbs share one signal and clamp against each other. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<[number, number]>([20, 70]);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · RangeSlider props" note="Both thumbs share one signal and clamp against each other." width={640}>
            <Stack gap="sm" style={{ "max-width": "480px" }}>
              <RangeSlider
                value={value()}
                onChange={setValue}
                min={args.min}
                max={args.max}
                step={args.step}
                label={args.label}
                disabled={args.disabled}
                hideHeader={args.hideHeader}
                commitOnRelease={args.commitOnRelease}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Band: ${value()[0]} – ${value()[1]}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Marks and a formatter make the band readable in domain units. */
export const MarksAndFormatting: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<[number, number]>([10, 40]);
      return (
        <SpecimenCanvas>
          <Specimen title="Marks & formatting" note="Marks and a formatter make the band readable in domain units." width={640}>
            <Stack gap="sm" style={{ "max-width": "520px" }}>
              <RangeSlider
                value={value()}
                onChange={setValue}
                min={0}
                max={60}
                step={5}
                label="RSI band"
                formatValue={(v) => `${v} RSI`}
                marks={[
                  { value: 0, label: "0" },
                  { value: 30, label: "30" },
                  { value: 60, label: "60" },
                ]}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Allowed: ${value()[0]} – ${value()[1]} RSI`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Collapsed and disabled thumbs; a collapsed pair still lets the upper thumb move right. */
export const CollapsedAndDisabled: Story = {
  render: () =>
    solidStory(() => {
      const [collapsed, setCollapsed] = createSignal<[number, number]>([50, 50]);
      const [locked, setLocked] = createSignal<[number, number]>([20, 80]);
      return (
        <SpecimenCanvas>
          <Specimen title="Collapsed & disabled" note="A collapsed pair still lets the upper thumb move right." width={640}>
            <Stack gap="lg" style={{ "max-width": "520px" }}>
              <RangeSlider value={collapsed()} onChange={setCollapsed} min={0} max={100} label="Collapsed pair" />
              <RangeSlider value={locked()} onChange={setLocked} min={0} max={100} label="Disabled band" disabled />
              <Text size="xs" c="dimmed" aria-live="polite">{`Collapsed at: ${collapsed()[0]}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Deferred commit keeps expensive consumers responsive during a drag. */
export const DeferredCommit: Story = {
  render: () =>
    solidStory(() => {
      const [committed, setCommitted] = createSignal<[number, number]>([25, 75]);
      return (
        <SpecimenCanvas>
          <Specimen title="Deferred commit" note="The band previews while dragging; the readout updates on release." width={640}>
            <Stack gap="sm" style={{ "max-width": "520px" }}>
              <RangeSlider
                value={committed()}
                onChange={setCommitted}
                min={0}
                max={100}
                step={1}
                label="Deferred band"
                commitOnRelease
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Committed: ${committed()[0]} – ${committed()[1]}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Out-of-domain and reversed input is clamped and ordered by the component itself. */
export const OutOfDomainInput: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<[number, number]>([80, 20]);
      return (
        <SpecimenCanvas>
          <Specimen title="Out-of-domain input" note="Initial tuple is reversed and partly outside 0–100; paint stays valid." width={640}>
            <Stack gap="sm" style={{ "max-width": "520px" }}>
              <RangeSlider value={value()} onChange={setValue} min={0} max={100} label="Normalised band" />
              <Text size="xs" c="dimmed" aria-live="polite">{`Emitted: ${value()[0]} – ${value()[1]}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
