import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { Alert, Button, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const colorOptions = ["success", "error", "danger", "warning", "info", "primary", "secondary"];
const variantOptions = ["default", "light", "outline", "filled", "transparent"];
const radiusOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Feedback/Alert",
  tags: ["autodocs"],
  component: Alert as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Alert is an inline status message with `role=\"alert\"`. `color` chooses the semantic severity, `variant` chooses filled / light / outline / default / transparent, and `title`, `icon`, `radius` and `withCloseButton` + `onClose` complete it. Filled alerts pick a contrast-safe ink; transparent really has no fill or border. The built-in close control carries aria-label=\"Close\".",
      },
    },
  },
  argTypes: {
    color: { control: { type: "select" }, options: colorOptions },
    variant: { control: { type: "select" }, options: variantOptions },
    radius: { control: { type: "select" }, options: radiusOptions },
    title: { control: { type: "text" }, description: "Optional bold heading." },
    children: { control: { type: "text" }, description: "Message body." },
    withCloseButton: { control: { type: "boolean" } },
    onClose: { action: "closed", description: "Called by the close button." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    color: "info",
    variant: "light",
    title: "Notice",
    children: "A neutral informational alert with no close button.",
  },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Alert" note="Inline status messages with a severity tone and a chrome variant. Specimens sit on raised panels so every combination stays legible.">
        <Section title="Playground" note="Pick a tone and variant with the controls above.">
          <Alert {...args} />
        </Section>
      </Catalog>
    )),
};

export const SeverityTones: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Alert — severity" note="Order and feed outcomes across the semantic scale; each cell shows the title, icon slot and message together.">
        <Section title="Success and error" note="The two most common outcomes, shown with icon slots and titles.">
          <SpecimenGrid min={340}>
            <Specimen fill label="success">
              <Alert color="success" title="Order accepted" icon={<span aria-hidden="true">✓</span>}>
                The paper order was written to the book.
              </Alert>
            </Specimen>
            <Specimen fill label="error">
              <Alert color="error" title="Feed unavailable" icon={<span aria-hidden="true">×</span>}>
                The option chain is temporarily unavailable. Retry on the next poll.
              </Alert>
            </Specimen>
            <Specimen fill label="danger (error alias)">
              <Alert color="danger" title="Risk limit breached">
                Danger and error share the negative token.
              </Alert>
            </Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Warning, info and muted" note="primary and secondary are the quieter severities.">
          <SpecimenGrid min={340}>
            <Specimen fill label="warning">
              <Alert color="warning" title="Short leg margin">Short options require margin; verify the estimate.</Alert>
            </Specimen>
            <Specimen fill label="info">
              <Alert color="info" title="Reconnected">Market data stream is back online.</Alert>
            </Specimen>
            <Specimen fill label="primary">
              <Alert color="primary">The primary severity resolves to the info colour.</Alert>
            </Specimen>
            <Specimen fill label="secondary">
              <Alert color="secondary">A muted, low-priority notice.</Alert>
            </Specimen>
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};

export const VariantsAndRadius: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Alert — chrome" note="Every variant and radius step, with a filled row that proves the contrast-safe ink.">
        <Section title="Variants" note="light uses a 10% tint, outline a hairline, filled a solid severity fill with contrast-picked ink, transparent no box at all.">
          <SpecimenGrid min={340}>
            <Specimen fill label="default">
              <Alert variant="default" color="info" title="Default">Low-emphasis tint (same as light).</Alert>
            </Specimen>
            <Specimen fill label="light">
              <Alert variant="light" color="success" title="Light">Positive tint with a soft border.</Alert>
            </Specimen>
            <Specimen fill label="outline">
              <Alert variant="outline" color="warning" title="Outline">Hairline border, transparent fill.</Alert>
            </Specimen>
            <Specimen fill label="filled">
              <Alert variant="filled" color="error" title="Filled">Solid negative fill, readable ink.</Alert>
            </Specimen>
            <Specimen fill label="transparent">
              <Alert variant="transparent" color="secondary" title="Transparent">No fill or border; ink carries the state.</Alert>
            </Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Filled tones" note="A solid fill must carry readable text on every severity, not just the darkest anchors.">
          <SpecimenGrid min={340}>
            {(["success", "warning", "info", "primary"] as const).map((color) => (
              <Specimen fill label={`filled ${color}`}>
                <Alert variant="filled" color={color}>{color} fill with contrast-safe text.</Alert>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
        <Section title="Radius" note="Radius steps map to the shared design tokens.">
          <SpecimenGrid min={220}>
            {radiusOptions.map((radius) => (
              <Specimen fill label={`radius ${radius}`}>
                <Alert radius={radius} color="info">Feed paused; the last snapshot is still shown.</Alert>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};

export const Dismissible: Story = {
  render: () =>
    solidStory(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <Catalog title="Alert — dismissible" note="The close control is a real button with an accessible label; reopening keeps the same frozen message.">
          <Section title="Close and reopen" note="onClose is called by the built-in button; no timers are involved.">
            <Stack gap="sm">
              <Show when={open()} fallback={<Text size="xs" c="dimmed">Alert dismissed.</Text>}>
                <Alert color="warning" title="Short leg margin" withCloseButton onClose={() => setOpen(false)}>
                  Short options require margin; verify the estimate.
                </Alert>
              </Show>
              <Button variant="outline" onClick={() => setOpen(true)}>Reopen alert</Button>
            </Stack>
          </Section>
        </Catalog>
      );
    }),
};

export const WithAction: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Alert — action" note="An optional action control sits beside the copy as a flex sibling — never inside the text block — and the close button stays independent.">
        <Section title="Action slot" note="The body grows to fill the alert, so the action stays on the same row at normal widths and may wrap below on a narrow container.">
          <SpecimenGrid min={340}>
            <Specimen fill label="action + close">
              <Alert
                color="warning"
                variant="light"
                title="Upstox connection required"
                icon={<span aria-hidden="true">!</span>}
                action={<Button size="xs" variant="outline">Open Settings</Button>}
                withCloseButton
                onClose={() => {}}
              >
                Reconnect in Settings to load live options data.
              </Alert>
            </Specimen>
            <Specimen fill label="action, no close">
              <Alert
                color="info"
                variant="light"
                title="Feed paused"
                action={<Button size="xs" variant="subtle">Retry</Button>}
              >
                The last snapshot is still shown.
              </Alert>
            </Specimen>
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};
