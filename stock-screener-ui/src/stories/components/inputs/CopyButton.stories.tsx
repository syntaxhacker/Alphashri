import type { Meta, StoryObj } from "@storybook/html-vite";
import { ActionIcon, Button, CopyButton, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas } from "./specimen";

interface CopyButtonArgs {
  value: string;
  timeout: number;
}

const meta: Meta<CopyButtonArgs> = {
  title: "Design System/Components/Inputs/CopyButton",
  component: CopyButton as unknown as Meta<CopyButtonArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/CopyButton.tsx — a headless render-prop control, not a button of its own. " +
          "Its children receive { copied, copy }; the caller supplies the actual Button or ActionIcon " +
          "and its visible label (or aria-label for an icon-only trigger). `value` is the text written " +
          "to the clipboard and `timeout` is the copied-state window in ms. Clipboard failures keep the " +
          "confirmation label off. No network or side effects beyond the user's click.",
      },
    },
  },
  args: {
    value: "NSE_EQ|INE002A01018",
    timeout: 1000,
  },
  argTypes: {
    value: { control: "text", description: "String written to the clipboard on click." },
    timeout: { control: "number", description: "Milliseconds before the copied flag returns to false." },
  },
};
export default meta;
type Story = StoryObj<CopyButtonArgs>;

/** Labelled Button trigger: the copied flag switches both the tone and the text. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Playground · CopyButton" note="Instrument key from the frozen quote fixture." width={640}>
          <Stack gap="sm" style={{ "max-width": "360px" }}>
            <CopyButton value={args.value} timeout={args.timeout}>
              {({ copied, copy }) => (
                <Button variant={copied ? "light" : "outline"} color={copied ? "success" : "primary"} onClick={copy}>
                  {copied ? "Copied instrument key" : "Copy instrument key"}
                </Button>
              )}
            </CopyButton>
            <Text size="xs" c="dimmed">The copied flag switches both the tone and the visible label.</Text>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** A short timeout makes the reset visible without waiting for the default second. */
export const ShortCopiedWindow: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Short copied window" note={`The copied flag clears after ${args.timeout} ms.`} width={640}>
          <Stack gap="sm" style={{ "max-width": "280px" }}>
            <CopyButton value={args.value} timeout={args.timeout}>
              {({ copied, copy }) => (
                <Button size="sm" variant="subtle" onClick={copy} aria-live="polite">
                  {copied ? "Copied" : "Copy again"}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Icon-only trigger needs an aria-label because copied/copy supply no text. */
export const IconOnlyTrigger: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Icon-only trigger" note="The trigger keeps a stable accessible name in both copied and idle states." width={640}>
          <Stack gap="sm" style={{ "max-width": "280px" }}>
            <CopyButton value={args.value} timeout={args.timeout}>
              {({ copied, copy }) => (
                <ActionIcon
                  variant="light"
                  color={copied ? "success" : "primary"}
                  aria-label={copied ? "Instrument key copied" : "Copy instrument key"}
                  onClick={copy}
                >
                  <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
                </ActionIcon>
              )}
            </CopyButton>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Edge case: an empty payload still produces the same labelled feedback path. */
export const EmptyPayload: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Blank value" note="An empty value still calls copy and reports success on write." width={640}>
          <Stack gap="sm" style={{ "max-width": "280px" }}>
            <CopyButton value="" timeout={1000}>
              {({ copied, copy }) => (
                <Button variant="default" size="sm" onClick={copy}>
                  {copied ? "Copied empty value" : "Copy empty value"}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};
