import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { Box, LoadingOverlay, Stack, Text } from "@/ui";
import type { UILoadingOverlayProps } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Feedback/LoadingOverlay",
  tags: ["autodocs"],
  component: LoadingOverlay as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "LoadingOverlay covers its nearest positioned ancestor while `visible` is true, marks the region `aria-busy`, and centres a Loader with padding so it never clips. The default fill is a palette-derived surface alpha, readable over both BG and SURFACE. `loaderProps`, `overlayProps` (colour, opacity, blur, fixed), `zIndex` and `children` are preserved.",
      },
    },
  },
  argTypes: {
    visible: { control: { type: "boolean" }, description: "Show or hide the overlay." },
    zIndex: { control: { type: "number" } },
    loaderProps: { control: false, description: "Forwarded to Loader: size / color / type." },
    overlayProps: { control: false, description: "color / opacity / blur / fixed." },
  },
};
export default meta;
type Story = StoryObj;

const Host = (props: { children: JSX.Element }) => (
  <Box
    bg="var(--color-fin-surface)"
    style={{ position: "relative", height: "200px", border: "1px solid var(--color-fin-border)", "border-radius": "6px", "padding": "16px" }}
  >
    <Stack gap="sm">
      <Text size="sm" fw={700}>Quote batch in flight</Text>
      <Text size="xs" c="dimmed">Panel content stays mounted underneath the overlay.</Text>
      <Text size="xs" c="dimmed">NIFTY 50 · BankNifty · FinNifty</Text>
    </Stack>
    {props.children}
  </Box>
);

export const Playground: Story = {
  args: { visible: true },
  render: (args) =>
    solidStory(() => (
      <Catalog title="LoadingOverlay" note="A busy region keeps its content visible beneath a translucent surface fill while work completes.">
        <Section title="Playground" note="The visible prop drives the overlay; loaderProps and overlayProps are forwarded untouched.">
          <Host>
            <LoadingOverlay {...(args as UILoadingOverlayProps)} />
          </Host>
        </Section>
      </Catalog>
    )),
};

export const OverContent: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="LoadingOverlay — surface and options" note="Same overlay over a panel and over the page background, with loader and overlay options exercised.">
        <Section title="Default overlay" note="A translucent surface fill over a relative host; the loader is centred with 16px of breathing room.">
          <Host>
            <LoadingOverlay visible />
          </Host>
        </Section>
        <Section title="Loader variants and overlay options" note="loaderProps forwards to Loader; overlayProps can add blur and opacity.">
          <Host>
            <LoadingOverlay
              visible
              zIndex={20}
              loaderProps={{ type: "dots", size: "lg", color: "info" }}
              overlayProps={{ blur: 3, opacity: 0.8 }}
            />
          </Host>
        </Section>
      </Catalog>
    )),
};

export const Toggle: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      return (
        <Catalog title="LoadingOverlay — interactive" note="Toggle the busy state without unmounting the panel behind it.">
          <Section title="Interactive visibility" note="The labelled button drives visible; the overlay marks the region aria-busy while shown.">
            <Host>
              <LoadingOverlay visible={visible()} loaderProps={{ type: "bars", color: "warning" }} />
            </Host>
            <Stack gap="xs" style={{ "padding-top": "16px" }}>
              <Text size="xs" c="dimmed">visible = {String(visible())}</Text>
              <button type="button" aria-label="Toggle loading overlay" onClick={() => setVisible(!visible())}>
                {visible() ? "Hide overlay" : "Show overlay"}
              </button>
            </Stack>
          </Section>
        </Catalog>
      );
    }),
};
