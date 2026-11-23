import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Stack, Text, Textarea } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface TextareaArgs {
  label: string;
  placeholder: string;
  description: string;
  error: string;
  size: "xs" | "md";
  minRows: number;
  maxRows: number;
  autosize: boolean;
  resize: "none" | "both" | "horizontal" | "vertical";
  disabled: boolean;
  required: boolean;
}

const meta: Meta<TextareaArgs> = {
  title: "Design System/Components/Inputs/Textarea",
  component: Textarea as unknown as Meta<TextareaArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Textarea.tsx — the multi-line member of the text family. `minRows`/`maxRows` " +
          "set the height band, `autosize` hides the resize handle, and `resize` takes the native CSS " +
          "values. `size` only switches the dense xs type step (11px/15px line) versus the default 13px/19px; " +
          "it is not a five-step height scale. `error` replaces `description` in the helper slot.",
      },
    },
  },
  args: {
    label: "Trade thesis",
    placeholder: "Why this setup is valid…",
    description: "Notes are saved with the order",
    error: "",
    size: "md",
    minRows: 3,
    maxRows: 6,
    autosize: false,
    resize: "vertical",
    disabled: false,
    required: false,
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the native textarea." },
    placeholder: { control: "text", description: "Placeholder shown while the field is empty." },
    description: { control: "text", description: "Helper text used when there is no error." },
    error: { control: "text", description: "Non-empty string marks the field invalid in the helper slot." },
    size: {
      control: "select",
      options: ["xs", "md"],
      description: "Dense xs type step or the default step; no lg/xl height variants exist.",
    },
    minRows: { control: "number", description: "Starting row count (defaults to 2)." },
    maxRows: { control: "number", description: "Growth ceiling in rows; 0/omitted means no ceiling." },
    autosize: { control: "boolean", description: "Hides the resize handle for a fixed band of rows." },
    resize: {
      control: "select",
      options: ["none", "both", "horizontal", "vertical"],
      description: "Native resize behaviour; default vertical, none when autosize is set and no value given.",
    },
    disabled: { control: "boolean", description: "Non-editable, reduced opacity." },
    required: { control: "boolean", description: "Native required attribute plus a visible asterisk." },
  },
};
export default meta;
type Story = StoryObj<TextareaArgs>;

/** Controlled multi-line field with a live character count. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [notes, setNotes] = createSignal("NIFTY 50 above R1 on above-average volume.");
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Textarea props" note="A controlled multi-line field with a live character count." width={640}>
            <Stack gap="sm" style={{ "max-width": "420px" }}>
              <Textarea
                label={args.label}
                placeholder={args.placeholder}
                description={args.description}
                error={args.error}
                size={args.size}
                minRows={args.minRows}
                maxRows={args.maxRows}
                autosize={args.autosize}
                resize={args.resize}
                disabled={args.disabled}
                required={args.required}
                value={notes()}
                onChange={setNotes}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Characters: ${notes().length}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Row bands and resize behaviour are independent of the two type steps. */
export const RowsAndResize: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Rows & resize" note="Row bands and resize behaviour are independent of the two type steps.">
          <SpecimenGrid cols={2}>
            <Textarea label="Two rows" placeholder="Short note" minRows={2} />
            <Textarea label="Four to six rows" placeholder="Longer note" minRows={4} maxRows={6} defaultValue="Session context:\n- Index opened above R1\n- Breadth positive\n- Volume above 20-day average" />
            <Textarea label="Dense xs" size="xs" placeholder="Compact note" minRows={2} description="11px type, 15px line height." />
            <Textarea label="No resize handle" autosize minRows={2} maxRows={4} placeholder="autosize hides the handle" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Validation and disabled states use the same helper slot as TextInput. */
export const States: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="States" note="Validation and disabled states use the same helper slot as TextInput.">
          <SpecimenGrid cols={2}>
            <Textarea label="Post-trade review" error="Review must be at least 20 characters" defaultValue="Too short" minRows={2} />
            <Textarea label="Locked notes" defaultValue="Imported from the order ticket." disabled description="Disabled fields cannot be edited." />
            <Textarea label="Required thesis" placeholder="Describe the setup" required minRows={2} />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
