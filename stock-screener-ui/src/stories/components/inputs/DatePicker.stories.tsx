import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { DatePicker, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { earliestExpiry, expiryDate, FIXTURE_LABEL, latestExpiry } from "./fixtures";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface DatePickerArgs {
  placeholder: string;
  clearable: boolean;
  disabled: boolean;
}

const iso = (date: Date | null): string =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "(none)";

const meta: Meta<DatePickerArgs> = {
  title: "Design System/Components/Inputs/DatePicker",
  component: DatePicker as unknown as Meta<DatePickerArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/dates/DatePicker.tsx — a native date input with local-calendar ISO conversion " +
          "(no UTC day shift). Single date only: not a range picker, with no time, timezone or locale model. " +
          "`placeholder` doubles as the visible label bound to the input; `labels` overrides the clear, " +
          "invalid and bare-input strings. `minDate`, `maxDate` and `excludeDate` constrain picks; a " +
          "rejected date restores the previous value and announces an alert through aria-describedby. " +
          "`value` with `onChange` is controlled and emits Date | null.",
      },
    },
  },
  args: {
    placeholder: "Expiry date",
    clearable: true,
    disabled: false,
  },
  argTypes: {
    placeholder: { control: "text", description: "Visible label above the date input." },
    clearable: { control: "boolean", description: "Adds a labelled clear button that emits null." },
    disabled: { control: "boolean", description: "Disables the native date input." },
  },
};
export default meta;
type Story = StoryObj<DatePickerArgs>;

/** Controlled date from a fixed fixture; the readout proves onChange fired. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<Date | null>(expiryDate());
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · DatePicker props" note={FIXTURE_LABEL} width={640}>
            <Stack gap="sm" style={{ "max-width": "320px" }}>
              <DatePicker
                placeholder={args.placeholder}
                clearable={args.clearable}
                disabled={args.disabled}
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Expiry: ${iso(value())}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** minDate/maxDate come from fixed local dates, never from the clock. */
export const BoundedDates: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<Date | null>(expiryDate());
      return (
        <SpecimenCanvas>
          <Specimen title="Bounded dates" note={`Allowed: ${iso(earliestExpiry())} … ${iso(latestExpiry())} — fixed local dates, never the clock.`} width={640}>
            <Stack gap="sm" style={{ "max-width": "320px" }}>
              <DatePicker
                placeholder="Expiry within bound"
                minDate={earliestExpiry()}
                maxDate={latestExpiry()}
                clearable
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Picked: ${iso(value())}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** excludeDate rejects weekends and reports the rejection with a labelled alert. */
export const ExcludedWeekends: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<Date | null>(expiryDate());
      const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
      return (
        <SpecimenCanvas>
          <Specimen title="Excluded weekends" note="Try a Saturday or Sunday — the previous value is restored." width={640}>
            <Stack gap="sm" style={{ "max-width": "320px" }}>
              <DatePicker
                placeholder="Trading expiry (weekdays)"
                excludeDate={isWeekend}
                clearable
                value={value()}
                onChange={setValue}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Picked: ${iso(value())}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Disabled and empty states: the placeholder label survives in both. */
export const DisabledAndEmpty: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<Date | null>(null);
      return (
        <SpecimenCanvas>
          <Specimen title="Disabled & empty" note="The placeholder label survives in both states.">
            <Stack gap="sm">
              <SpecimenGrid cols={2}>
                <DatePicker placeholder="Locked expiry" defaultValue={expiryDate()} disabled />
                <DatePicker placeholder="No expiry selected" clearable value={value()} onChange={setValue} />
              </SpecimenGrid>
              <Text size="xs" c="dimmed" aria-live="polite">{`Cleared value: ${iso(value())}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
