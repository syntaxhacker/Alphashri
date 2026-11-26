import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Text } from "@/ui";
import { RangeInput } from "@/components/common/RangeInput";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen 52-week range filter · 2026-11-20 09:15 IST";

type RangeArgs = {
  label: string;
  domain: [number, number];
  step: number;
  disabled: boolean;
  commitOnRelease: boolean;
};

const meta: Meta<RangeArgs> = {
  title: "App/Components/RangeInput",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A dual-thumb range control plus paired exact-entry fields from " +
          "src/components/common/RangeInput.tsx. The open ends mean unbounded: an untouched " +
          "range stays `null` on both sides instead of clamping to the domain. The numeric " +
          "fields carry `<label>`-derived aria labels (`<label> minimum` / `maximum`).",
      },
    },
  },
  args: {
    label: "52-week distance",
    domain: [0, 100],
    step: 5,
    disabled: false,
    commitOnRelease: false,
  },
  argTypes: {
    label: { control: "text", description: "Visible label; also prefixes both input aria labels." },
    domain: { control: "object", description: "Required slider axis [min, max]." },
    step: { control: { type: "range", min: 1, max: 25, step: 1 }, description: "Slider / input step." },
    disabled: { control: "boolean", description: "Disables slider and both numeric fields." },
    commitOnRelease: { control: "boolean", description: "Preview during drag, notify once on release." },
  },
};
export default meta;
type Story = StoryObj<RangeArgs>;

/** A toolbar strip gives the bare control the same context as the screener filters. */
const FilterStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** Controls bind to real RangeInputProps; min/max live in a frozen local signal. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [min, setMin] = createSignal<number | null>(10);
      const [max, setMax] = createSignal<number | null>(80);
      return (
        <DemoStack>
          <DemoPanel
            title="Range input · playground"
            detail={FIXTURE_LABEL}
            meta={`step ${args.step} · ${args.disabled ? "disabled" : "enabled"}`}
            testId="story-range-playground-frame"
          >
            <Specimen label="52-week distance band" detail="Open ends stay null instead of clamping to the domain.">
              <FilterStrip>
                <Box style={{ width: "460px" }}>
                  <RangeInput
                    label={args.label}
                    domain={args.domain}
                    min={min()}
                    max={max()}
                    onMinChange={setMin}
                    onMaxChange={setMax}
                    step={args.step}
                    disabled={args.disabled}
                    commitOnRelease={args.commitOnRelease}
                    formatValue={(value) => `${value}%`}
                    testId="story-range-playground"
                  />
                </Box>
              </FilterStrip>
              <Text size="xs" c="secondary" aria-live="polite">
                {`Selection: ${min() ?? "unbounded"}% – ${max() ?? "unbounded"}%`}
              </Text>
            </Specimen>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

/** No selection is a real state, not the domain endpoints. */
export const Unbounded: Story = {
  render: () =>
    solidStory(() => {
      const [min, setMin] = createSignal<number | null>(null);
      const [max, setMax] = createSignal<number | null>(null);
      return (
        <DemoStack>
          <DemoPanel
            title="Range input · unbounded"
            detail={`${FIXTURE_LABEL} · P/E band with both ends open`}
            metaNode={
              <Text size="xs" c="secondary" aria-live="polite">
                {`P/E band: ${min() === null ? "no floor" : `${min()}x`} · ${max() === null ? "no ceiling" : `${max()}x`}`}
              </Text>
            }
            testId="story-range-unbounded-frame"
          >
            <FilterStrip>
              <Box style={{ width: "420px" }}>
                <RangeInput
                  label="P/E band"
                  domain={[0, 60]}
                  min={min()}
                  max={max()}
                  onMinChange={setMin}
                  onMaxChange={setMax}
                  step={1}
                  formatValue={(value) => `${value}x`}
                  testId="story-range-unbounded"
                />
              </Box>
            </FilterStrip>
            <Text size="xs" c="secondary" aria-live="polite">
              {`Min: ${min() ?? "unbounded"}x · Max: ${max() ?? "unbounded"}x`}
            </Text>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const WithMarks: Story = {
  render: () =>
    solidStory(() => {
      const [min, setMin] = createSignal<number | null>(20);
      const [max, setMax] = createSignal<number | null>(null);
      return (
        <DemoStack>
          <DemoPanel
            title="Range input · marks"
            detail={`${FIXTURE_LABEL} · RSI filter with oversold / neutral / overbought marks`}
            meta="marks at 30 · 50 · 70"
            testId="story-range-marks-frame"
          >
            <FilterStrip>
              <Box style={{ width: "460px" }}>
                <RangeInput
                  label="RSI"
                  domain={[0, 100]}
                  min={min()}
                  max={max()}
                  onMinChange={setMin}
                  onMaxChange={setMax}
                  step={1}
                  marks={[
                    { value: 30, label: "30" },
                    { value: 50, label: "50" },
                    { value: 70, label: "70" },
                  ]}
                  formatValue={(value) => String(value)}
                  testId="story-range-marks"
                />
              </Box>
            </FilterStrip>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const Disabled: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Range input · disabled"
          detail={`${FIXTURE_LABEL} · volume filter locked by the active preset`}
          meta="slider + fields disabled"
          testId="story-range-disabled-frame"
        >
          <FilterStrip>
            <Box style={{ width: "420px" }}>
              <RangeInput
                label="Volume (locked)"
                domain={[0, 100]}
                min={25}
                max={90}
                step={5}
                disabled
                formatValue={(value) => `${value}M`}
                testId="story-range-disabled"
              />
            </Box>
          </FilterStrip>
        </DemoPanel>
      </DemoStack>
    )),
};
