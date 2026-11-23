import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Indicator, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const colorOptions = ["primary", "success", "error", "danger", "warning", "info", "secondary", "default"];
const positionOptions = ["top-start", "top-end", "bottom-start", "bottom-end"] as const;

const Target = () => (
  <Box p="sm" bg="var(--color-fin-surface)" style={{ border: "1px solid var(--color-fin-border)", "min-width": "96px", "text-align": "center" }}>
    Inbox
  </Box>
);

const meta: Meta = {
  title: "Design System/Components/Feedback/Indicator",
  tags: ["autodocs"],
  component: Indicator as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Indicator wraps content with a small status dot. label puts text in the dot, color picks the semantic tone, size / offset tune geometry, position takes a documented corner, processing adds a ping ring and disabled removes the dot while keeping the wrapper and its test id.",
      },
    },
  },
  argTypes: {
    label: { control: { type: "text" }, description: "Text inside the dot." },
    color: { control: { type: "select" }, options: colorOptions },
    size: { control: { type: "number" }, description: "Dot diameter in px (default 8)." },
    offset: { control: { type: "number" }, description: "px shift outward on both axes." },
    position: { control: { type: "select" }, options: positionOptions },
    disabled: { control: { type: "boolean" } },
    processing: { control: { type: "boolean" } },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { label: "3", color: "error", size: 12, position: "top-end", processing: false, disabled: false },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Indicator" note="A status dot anchored to a real surface. Controls above select the label, tone and corner.">
        <Section title="Playground" note="The target is a surfaced panel so the dot and its label stay readable.">
          <Specimen label={`${args.color} · ${args.position}`}>
            <Indicator {...args}>
              <Target />
            </Indicator>
          </Specimen>
        </Section>
      </Catalog>
    )),
};

export const PositionsAndSizes: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Indicator — geometry" note="Four corners, a shifted offset and four dot sizes on identical targets.">
        <Section title="Corner positions" note="The four documented position values; offset adds a translate on both axes.">
          <SpecimenGrid min={200}>
            {positionOptions.map((position) => (
              <Specimen label={position}>
                <Indicator position={position} color="info" label="•">
                  <Target />
                </Indicator>
              </Specimen>
            ))}
            <Specimen label="offset 6">
              <Indicator color="warning" label="4" offset={6}>
                <Target />
              </Indicator>
            </Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Sizes" note="size sets the dot diameter; larger dots scale the label font with it.">
          <SpecimenGrid min={200}>
            {[6, 8, 12, 18].map((size) => (
              <Specimen label={`size ${size}`}>
                <Indicator size={size} color="primary" label="9">
                  <Target />
                </Indicator>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};

export const StatesAndColors: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Indicator — states" note="Processing, disabled and every semantic tone on the same wrapped target.">
        <Section title="States" note="processing adds the ping ring; disabled removes the dot and ping but keeps the wrapper.">
          <SpecimenGrid min={200}>
            <Specimen label="plain"><Indicator label="3" color="error"><Target /></Indicator></Specimen>
            <Specimen label="processing"><Indicator label="LIVE" color="success" processing><Target /></Indicator></Specimen>
            <Specimen label="disabled"><Indicator color="warning" disabled><Target /></Indicator></Specimen>
            <Specimen label="overflow"><Indicator color="info" label="9+"><Target /></Indicator></Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Semantic colours" note="Every documented color value on the same wrapped target.">
          <SpecimenGrid min={180}>
            {colorOptions.map((color) => (
              <Specimen label={color}>
                <Indicator color={color} label="1"><Target /></Indicator>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};

export const Interactive: Story = {
  render: () =>
    solidStory(() => {
      const [disabled, setDisabled] = createSignal(false);
      const [processing, setProcessing] = createSignal(false);
      return (
        <Catalog title="Indicator — interactive" note="Two labelled checkboxes drive the real disabled and processing props.">
          <Section title="Live state controls" note="The target stays mounted; only the dot state changes.">
            <Specimen label={`disabled ${String(disabled())} · processing ${String(processing())}`}>
              <Indicator label="3" color="success" disabled={disabled()} processing={processing()}>
                <Target />
              </Indicator>
            </Specimen>
            <Stack gap="sm" style={{ "padding-top": "16px" }}>
              <label style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
                <input
                  type="checkbox"
                  checked={disabled()}
                  aria-label="Disable indicator"
                  onChange={(event) => setDisabled(event.currentTarget.checked)}
                />
                <Text size="xs">disabled = {String(disabled())}</Text>
              </label>
              <label style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
                <input
                  type="checkbox"
                  checked={processing()}
                  aria-label="Show processing ping"
                  onChange={(event) => setProcessing(event.currentTarget.checked)}
                />
                <Text size="xs">processing = {String(processing())}</Text>
              </label>
            </Stack>
          </Section>
        </Catalog>
      );
    }),
};
