import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { PasswordInput, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface PasswordInputArgs {
  label: string;
  placeholder: string;
  description: string;
  error: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  disabled: boolean;
  required: boolean;
  visibilityToggleButtonLabel: string;
}

const meta: Meta<PasswordInputArgs> = {
  title: "Design System/Components/Inputs/PasswordInput",
  component: PasswordInput as unknown as Meta<PasswordInputArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/PasswordInput.tsx — the text field with a monospace masked value and a reveal " +
          "eye button. `visible`/`onVisibilityChange` make the reveal state controlled; without them it " +
          "is internal. `visibilityToggleButtonLabel` overrides the eye button's accessible name. " +
          "It shares the text-family height scale (xs 24 … xl 42) and the error/description helper slot.",
      },
    },
  },
  args: {
    label: "Broker API key",
    placeholder: "Enter secret",
    description: "Stored locally, never sent to the catalog",
    error: "",
    size: "md",
    disabled: false,
    required: false,
    visibilityToggleButtonLabel: "Toggle password visibility",
  },
  argTypes: {
    label: { control: "text", description: "Visible label bound to the native input." },
    placeholder: { control: "text", description: "Placeholder shown while the field is empty." },
    description: { control: "text", description: "Helper text used when there is no error." },
    error: { control: "text", description: "Non-empty string marks the field invalid in the helper slot." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Field height/type step shared with TextInput.",
    },
    disabled: { control: "boolean", description: "Disables the input and the reveal button." },
    required: { control: "boolean", description: "Native required attribute plus a visible asterisk." },
    visibilityToggleButtonLabel: { control: "text", description: "Accessible name of the reveal button." },
  },
};
export default meta;
type Story = StoryObj<PasswordInputArgs>;

/** Both the value and the reveal flag live in signals owned by the story. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [secret, setSecret] = createSignal("upstox-demo-key");
      const [visible, setVisible] = createSignal(false);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · PasswordInput props" note="Both the value and the reveal flag live in signals owned by the story." width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <PasswordInput
                label={args.label}
                placeholder={args.placeholder}
                description={args.description}
                error={args.error}
                size={args.size}
                disabled={args.disabled}
                required={args.required}
                visibilityToggleButtonLabel={args.visibilityToggleButtonLabel}
                value={secret()}
                onChange={setSecret}
                visible={visible()}
                onVisibilityChange={setVisible}
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`Revealed: ${visible() ? "yes" : "no"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Masked fields align with TextInput at every height step. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 · lg 38 · xl 42 px — masked fields align with TextInput.">
          <SpecimenGrid cols={2}>
            <PasswordInput size="xs" label="Extra small" defaultValue="demo-secret" />
            <PasswordInput size="sm" label="Small" defaultValue="demo-secret" />
            <PasswordInput size="md" label="Medium (default)" defaultValue="demo-secret" />
            <PasswordInput size="lg" label="Large" defaultValue="demo-secret" />
            <PasswordInput size="xl" label="Extra large" defaultValue="demo-secret" />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Controlled reveal: the caller can force the state from its own action. */
export const ControlledVisibility: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      return (
        <SpecimenCanvas>
          <Specimen title="Controlled visibility" note="The eye reports every toggle back to the caller." width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <PasswordInput
                label="Visible secret"
                defaultValue="upstox-demo-key"
                visible={visible()}
                onVisibilityChange={setVisible}
                visibilityToggleButtonLabel="Hide the API key"
                description="Starts revealed; the eye reports every toggle back to the caller."
              />
              <Text size="xs" c="dimmed" aria-live="polite">{`input type: ${visible() ? "text" : "password"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Validation and disabled states, including a disabled reveal button. */
export const States: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="States" note="Validation and disabled states, including a disabled reveal button.">
          <SpecimenGrid cols={2}>
            <PasswordInput label="New password" error="Password must be at least 12 characters" defaultValue="short" />
            <PasswordInput label="Locked secret" defaultValue="demo-secret" disabled description="Reveal is disabled with the field." />
            <PasswordInput label="Required secret" placeholder="Enter secret" required />
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
