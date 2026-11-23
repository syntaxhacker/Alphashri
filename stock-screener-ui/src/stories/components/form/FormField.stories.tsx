import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { FormField, Stack, Text } from "@/ui";
import type { UIFormFieldIds } from "@/ui";
import { solidStory } from "@/stories/solidStory";

interface FormFieldArgs {
  label: string;
  description: string;
  error: string;
  required: boolean;
}

const meta: Meta<FormFieldArgs> = {
  title: "Design System/Components/Form/FormField",
  component: FormField as unknown as Meta<FormFieldArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/form/FormField.tsx — an unstyled field shell that owns ids and ARIA wiring. " +
          "The caller supplies the one control through the render prop; spreading `ids.controlProps` " +
          "binds its id, description/error ids, invalid state and required state. Errors render as " +
          "elements, and a bare `error={true}` flags the control without printing text.",
      },
    },
  },
  args: {
    label: "Instrument key",
    description: "NSE symbol or exchange|instrument key",
    error: "",
    required: false,
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the control by htmlFor." },
    description: { control: "text", description: "Helper text; empty string renders nothing." },
    error: { control: "text", description: "Non-empty text renders the error node and sets aria-invalid." },
    required: { control: "boolean", description: "Adds the marker to the label and aria-required to the control." },
  },
};
export default meta;
type Story = StoryObj<FormFieldArgs>;

/** Dark-token specimen frame — no palette hex is repeated outside palette.ts. */
function FieldCard(props: { title: string; note?: string; children: JSX.Element }) {
  return (
    <section
      style={{
        "box-sizing": "border-box",
        width: "100%",
        padding: "16px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "6px",
        background: "var(--color-fin-surface)",
      }}
    >
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">{props.title}</Text>
        {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
        {props.children}
      </Stack>
    </section>
  );
}

const inputClass =
  "w-full min-w-0 rounded-[6px] border border-fin-border bg-fin-surface-alt px-2 py-1 text-xs text-fin-text " +
  "placeholder:text-fin-text-muted aria-[invalid=true]:border-fin-negative";

function TextControl(ids: UIFormFieldIds) {
  return <input {...ids.controlProps} className={inputClass} placeholder="NSE_EQ|INE002A01018" autocomplete="off" />;
}

/** All props are real: the signal is the only source of truth for the typed value. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal("");
      return (
        <Stack gap="lg" style={{ width: "100%", "max-width": "640px", margin: "0 auto" }}>
          <FieldCard title="Playground · FormField" note="The render prop wires a native input to the field shell.">
            <FormField
              label={args.label}
              description={args.description}
              error={args.error || false}
              required={args.required}
            >
              {(ids) => (
                <input
                  {...ids.controlProps}
                  className={inputClass}
                  placeholder="NSE_EQ|INE002A01018"
                  autocomplete="off"
                  value={value()}
                  onInput={(event) => setValue(event.currentTarget.value)}
                />
              )}
            </FormField>
            <Text size="xs" c="dimmed" aria-live="polite">{`Value: ${value() || "(empty)"}`}</Text>
          </FieldCard>
        </Stack>
      );
    }),
};

/** Label, description, error and required are independent props, not states of one flag. */
export const States: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ width: "100%", "max-width": "720px", margin: "0 auto" }}>
        <FieldCard title="Label only" note="A visible label bound to the control by htmlFor.">
          <FormField label="Symbol" data-testid="field-label-only">{TextControl}</FormField>
        </FieldCard>
        <FieldCard title="Label + description" note="The description id joins aria-describedby.">
          <FormField label="Instrument key" description="Format: EXCHANGE|SYMBOL" data-testid="field-description">
            {TextControl}
          </FormField>
        </FieldCard>
        <FieldCard title="Error" note="Error text gets its own id and sets aria-invalid on the control.">
          <FormField
            label="Quantity"
            description="Whole lots only"
            error="Quantity must be a positive multiple of the lot size"
            data-testid="field-error"
          >
            {TextControl}
          </FormField>
        </FieldCard>
        <FieldCard title="Required + flag-only error" note="The marker is visible; a boolean error adds no copy.">
          <FormField label="Strategy" required error data-testid="field-required">
            {TextControl}
          </FormField>
        </FieldCard>
      </Stack>
    )),
};

/** The render prop also wires a non-text control without cloning it. */
export const CustomControl: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ width: "100%", "max-width": "640px", margin: "0 auto" }}>
        <FieldCard title="Custom control" note="ids.controlProps spreads onto any native or custom control.">
          <FormField label="Universe" description="Saved with the screener view" required>
            {(ids) => (
              <select {...ids.controlProps} className={inputClass}>
                <option value="nifty">NIFTY 500</option>
                <option value="banknifty">BANKNIFTY</option>
              </select>
            )}
          </FormField>
        </FieldCard>
      </Stack>
    )),
};
