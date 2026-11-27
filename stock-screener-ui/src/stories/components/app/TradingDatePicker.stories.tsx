import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Text } from "@/ui";
import { TradingDatePicker } from "@/components/common/TradingDatePicker";
import { solidStory } from "@/stories/solidStory";
import { DemoPanel, DemoStack, Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen trading-date control · session 2026-11-20";

type DatePickerArgs = {
  value: string;
  minDate: string;
  maxDate: string;
  w: number;
};

const meta: Meta<DatePickerArgs> = {
  title: "App/Components/TradingDatePicker",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A string-in/string-out date picker from src/components/common/TradingDatePicker.tsx. " +
          "Trading filters store `YYYY-MM-DD` strings, so the local-midnight `Date` conversion " +
          "lives here. Exchange holidays come from the shared holiday store; `excludeDate` adds " +
          "extra non-trading days. No network request is made by the story.",
      },
    },
  },
  args: { value: "2026-11-20", minDate: "2026-11-01", maxDate: "2026-11-30", w: 220 },
  argTypes: {
    value: { control: "text", description: "Selected day as YYYY-MM-DD." },
    minDate: { control: "text", description: "Earliest selectable day as YYYY-MM-DD." },
    maxDate: { control: "text", description: "Latest selectable day as YYYY-MM-DD." },
    w: { control: { type: "range", min: 160, max: 320, step: 20 }, description: "Explicit control width in px." },
  },
};
export default meta;
type Story = StoryObj<DatePickerArgs>;

/** The picker sits in a filter strip, the way the replay toolbar stages it. */
const FilterStrip = (props: { children: import("solid-js").JSX.Element }) => (
  <Box style={{ padding: "12px 16px", "background-color": "var(--color-fin-surface-alt)", "border-radius": "4px" }}>
    {props.children}
  </Box>
);

/** The story owns the frozen string value; no system clock is read. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal(args.value);
      return (
        <DemoStack>
          <DemoPanel
            title="Trading date picker · playground"
            detail={FIXTURE_LABEL}
            meta={`${args.minDate} → ${args.maxDate}`}
            testId="story-date-playground-frame"
          >
            <Specimen label="Session selector" detail="String in, string out; the holiday store supplies disabled days.">
              <FilterStrip>
                <Box style={{ width: "420px" }}>
                  <TradingDatePicker
                    value={value()}
                    onChange={setValue}
                    minDate={args.minDate}
                    maxDate={args.maxDate}
                    w={args.w}
                    aria-label="Frozen trading date"
                  />
                </Box>
              </FilterStrip>
              <Text size="xs" c="secondary" aria-live="polite">{`Selected (string): ${value()}`}</Text>
            </Specimen>
          </DemoPanel>
        </DemoStack>
      );
    }),
};

export const DefaultValueAndNoBounds: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trading date picker · unbounded"
          detail={`${FIXTURE_LABEL} · uncontrolled defaultValue, no min/max`}
          meta="default: 2026-11-20 · no bounds"
          testId="story-date-unbounded-frame"
        >
          <FilterStrip>
            <Box style={{ width: "420px" }}>
              <TradingDatePicker defaultValue="2026-11-20" w={220} aria-label="Frozen date, unbounded" />
            </Box>
          </FilterStrip>
        </DemoPanel>
      </DemoStack>
    )),
};

/** Extra excluded days layer on top of the exchange holiday calendar. */
export const ExcludedDays: Story = {
  render: () =>
    solidStory(() => (
      <DemoStack>
        <DemoPanel
          title="Trading date picker · excluded days"
          detail={`${FIXTURE_LABEL} · 2026-11-24 and 2026-11-26 excluded`}
          meta="2 extra non-trading days"
          testId="story-date-excluded-frame"
        >
          <FilterStrip>
            <Box style={{ width: "420px" }}>
              <TradingDatePicker
                value="2026-11-20"
                minDate="2026-11-16"
                maxDate="2026-11-30"
                excludeDate={(day) => day === "2026-11-24" || day === "2026-11-26"}
                w={220}
                aria-label="Frozen date with exclusions"
              />
            </Box>
          </FilterStrip>
        </DemoPanel>
      </DemoStack>
    )),
};
