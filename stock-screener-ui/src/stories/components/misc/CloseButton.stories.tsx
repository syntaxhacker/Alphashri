import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, CloseButton, Group, Stack, Text } from "@/ui";
import { LabelledSample, Page, Readout, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Misc/CloseButton",
  tags: ["autodocs"],
  component: CloseButton as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "CloseButton is a labelled × button. `size` maps xs/sm to 20px, md to 24px and lg/xl to 32px (numbers are bucketed), `variant` picks filled / light / outline / subtle / transparent chrome, and `disabled` dims the button and blocks pointer events. The component ships an `aria-label=\"close\"` default; pass a more specific one for each placement so screen-reader users know what will be dismissed.",
      },
    },
  },
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl", 28],
      description: "Preset size or numeric px (numbers bucket to 20 / 24 / 32px).",
    },
    variant: {
      control: "select",
      options: ["transparent", "filled", "light", "outline", "subtle"],
      description: "Chrome treatment; transparent is the default.",
    },
    disabled: { control: "boolean", description: "Dim the button and block clicks." },
    onClick: { action: "close clicked", description: "Called with no arguments when activated." },
  },
  args: { size: "md", variant: "transparent", disabled: false },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [clicks, setClicks] = createSignal(0);
      return (
        <Page>
          <Specimen
            title="Playground"
            code={`size="${String(args.size)}" · variant="${String(args.variant)}" · disabled=${String(args.disabled)}`}
          >
            <Stack gap="sm" align="flex-start">
              <Readout>{clicks()} panel dismissal{clicks() === 1 ? "" : "s"} recorded</Readout>
              <CloseButton
                size={args.size}
                variant={args.variant}
                disabled={args.disabled}
                aria-label="Close playground panel"
                onClick={() => setClicks((n) => n + 1)}
              />
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Sizes" note="Preset sizes bucket to 20px (xs/sm), 24px (md) and 32px (lg/xl).">
          <Group gap="sm" align="flex-start" wrap="wrap">
            <LabelledSample label="xs · 20"><CloseButton size="xs" variant="outline" aria-label="Close extra small" /></LabelledSample>
            <LabelledSample label="sm · 20"><CloseButton size="sm" variant="outline" aria-label="Close small" /></LabelledSample>
            <LabelledSample label="md · 24"><CloseButton size="md" variant="outline" aria-label="Close medium" /></LabelledSample>
            <LabelledSample label="lg · 32"><CloseButton size="lg" variant="outline" aria-label="Close large" /></LabelledSample>
            <LabelledSample label="xl · 32"><CloseButton size="xl" variant="outline" aria-label="Close extra large" /></LabelledSample>
            <LabelledSample label="28 · bucketed"><CloseButton size={28} variant="outline" aria-label="Close numeric size" /></LabelledSample>
          </Group>
        </Specimen>
      </Page>
    )),
};

export const Variants: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          {(["transparent", "filled", "light", "outline", "subtle"] as const).map((variant) => (
            <Specimen title="Variant" code={`variant="${variant}"`} note="The aria-label names the panel that would be dismissed.">
              <LabelledSample label={variant}>
                <CloseButton size="md" variant={variant} aria-label={`Close ${variant} example`} />
              </LabelledSample>
            </Specimen>
          ))}
        </SpecimenGrid>
      </Page>
    )),
};

export const Disabled: Story = {
  render: () =>
    solidStory(() => {
      const [clicks, setClicks] = createSignal(0);
      return (
        <Page>
          <Specimen
            title="Disabled"
            note="The native disabled attribute plus pointer-events-none keep the button inert; the aria-label still names it."
          >
            <Stack gap="sm" align="flex-start">
              <Group gap="sm" align="center">
                <CloseButton disabled aria-label="Close disabled panel" onClick={() => setClicks((n) => n + 1)} />
                <Readout>{clicks()} dismissal{clicks() === 1 ? "" : "s"} recorded</Readout>
              </Group>
              <Text size="xs" c="dimmed">Clicking the locked control above does not increment the counter.</Text>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => {
      const [bannerVisible, setBannerVisible] = createSignal(true);
      const [panelVisible, setPanelVisible] = createSignal(true);
      return (
        <Page>
          <Specimen title="Dismissible chrome" note="Both controls carry a specific aria-label for the surface they close.">
            <Stack gap="sm">
              <Show
                when={bannerVisible()}
                fallback={<Text size="xs" c="dimmed">Notice dismissed — reopen it below.</Text>}
              >
                <Box
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    gap: "8px",
                    border: "1px solid var(--color-fin-border)",
                    "border-radius": "4px",
                    background: "var(--color-fin-surface-alt)",
                    padding: "8px",
                  }}
                >
                  <Text size="sm">Feed resumed · quotes are live again.</Text>
                  <CloseButton size="sm" variant="subtle" aria-label="Dismiss feed notice" onClick={() => setBannerVisible(false)} />
                </Box>
              </Show>
              <Show when={panelVisible()}>
                <Box style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface)" }}>
                  <Group gap="sm" align="center" style={{ "justify-content": "space-between", padding: "8px", "border-bottom": "1px solid var(--color-fin-border)" }}>
                    <Text size="sm" fw={600}>Panel header</Text>
                    <CloseButton aria-label="Close panel" onClick={() => setPanelVisible(false)} />
                  </Group>
                  <Text size="sm" c="dimmed" style={{ padding: "8px" }}>
                    The body stays mounted until the header close is pressed.
                  </Text>
                </Box>
              </Show>
              <Group gap="xs">
                <button type="button" aria-label="Reopen notice" onClick={() => setBannerVisible(true)}>Reopen notice</button>
                <button type="button" aria-label="Reopen panel" onClick={() => setPanelVisible(true)}>Reopen panel</button>
              </Group>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};
