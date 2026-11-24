import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { alpha, Box, Button, Group, Overlay, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid, Stage } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Overlay/Overlay",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: Overlay as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Overlay is a translucent backdrop that fills its container (`fixed={false}`) or the viewport (`fixed`, the default). `color` sets the background, `opacity` dims the whole layer, `blur` applies a backdrop-filter, `zIndex` controls stacking and `center` wraps children in a centred flex box. It is a plain layer: it does not trap focus or dismiss itself — wire `onClick` for that.",
      },
    },
  },
  argTypes: {
    color: { control: "text", description: "CSS colour for the layer; defaults to a palette-derived translucent black." },
    opacity: { control: { type: "range", min: 0, max: 1, step: 0.05 }, description: "Opacity of the whole layer." },
    blur: { control: { type: "number", min: 0, step: 1 }, description: "backdrop-filter blur in px (the prop also accepts a CSS length)." },
    zIndex: { control: "text", description: "z-index for the layer." },
    fixed: { control: "boolean", description: "Position fixed to the viewport (true) or absolute in the parent (false)." },
    center: { control: "boolean", description: "Wrap children in a centred flex container." },
  },
};
export default meta;
type Story = StoryObj;

function BackdropContent() {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>Underlying panel content</Text>
      <Text size="xs" c="dimmed">The layer sits above this copy; blur and opacity apply to the layer itself.</Text>
      <SampleRow label="Universe" value="NIFTY 500" />
      <SampleRow label="Rows" value="214 scanned" />
    </Stack>
  );
}

function FrozenCard(props: { title: string; body: string }) {
  return (
    <Box
      style={{
        padding: "12px 16px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface)",
        "box-shadow": palette.DIALOG_SHADOW,
        "max-width": "340px",
      }}
    >
      <Stack gap="xs">
        <Text size="sm" fw={600}>{props.title}</Text>
        <Text size="xs" c="dimmed">{props.body}</Text>
      </Stack>
    </Box>
  );
}

export const BlurAndOpacity: Story = {
  render: () =>
    solidStory(() => {
      const [blur, setBlur] = createSignal(0);
      const [opacity, setOpacity] = createSignal(0.5);
      const [tinted, setTinted] = createSignal(false);
      return (
        <Page>
          <Specimen
            title="Blur and opacity"
            note="The layer dims the panel; a card above it shows the reading that stays legible while the backdrop is on."
          >
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                <Button size="xs" variant={blur() ? "filled" : "outline"} onClick={() => setBlur((v) => (v ? 0 : 4))}>
                  blur: {blur()}px
                </Button>
                <Button size="xs" variant={opacity() < 0.5 ? "filled" : "outline"} onClick={() => setOpacity((v) => (v < 0.5 ? 0.8 : 0.3))}>
                  opacity: {opacity()}
                </Button>
                <Button size="xs" variant={tinted() ? "filled" : "outline"} onClick={() => setTinted((v) => !v)}>
                  tint: {tinted() ? "primary" : "default"}
                </Button>
              </Group>
              <Readout>{tinted() ? "Brand-tinted backdrop" : "Neutral backdrop"}</Readout>
              <Stage height={200}>
                <BackdropContent />
                <Overlay
                  fixed={false}
                  blur={blur()}
                  opacity={opacity()}
                  color={tinted() ? alpha(palette.PRIMARY, 0.35) : undefined}
                />
                <Box style={{ position: "relative", "z-index": 2, "margin-top": "12px" }}>
                  <FrozenCard title="Layer readout" body="Change blur, opacity or tint above to compare the backdrop." />
                </Box>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const ClickToDismiss: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      const [clicks, setClicks] = createSignal(0);
      return (
        <Page>
          <Specimen title="Click to dismiss" note="The layer does not dismiss itself; onClick is wired here and the card stays above it.">
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
                  {visible() ? "Hide overlay" : "Show overlay"}
                </Button>
                <Button size="xs" variant="outline" onClick={() => setClicks(0)}>Reset click count</Button>
              </Group>
              <Readout>{clicks()} backdrop click{clicks() === 1 ? "" : "s"} recorded</Readout>
              <Stage height={200}>
                <BackdropContent />
                <Show when={visible()}>
                  <Overlay fixed={false} center zIndex={2} onClick={() => setClicks((c) => c + 1)}>
                    <FrozenCard title="Centred card" body="Click the backdrop to count a dismissal event." />
                  </Overlay>
                </Show>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Playground: Story = {
  args: {
    opacity: 0.5,
    blur: 0,
    fixed: false,
    center: true,
    zIndex: 2,
  },
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen title="Playground" code={`opacity=${String(args.opacity)} · blur=${String(args.blur)} · center=${String(args.center)}`}>
          <Stage height={220}>
            <BackdropContent />
            <Overlay
              fixed={Boolean(args.fixed)}
              center={Boolean(args.center)}
              opacity={Number(args.opacity ?? 0.5)}
              blur={Number(args.blur ?? 0)}
              zIndex={Number(args.zIndex ?? 2)}
            >
              <FrozenCard title="Overlay child" body="Centred copy stays readable over the dimmed panel." />
            </Overlay>
          </Stage>
        </Specimen>
      </Page>
    )),
};

export const FixedViewportLayer: Story = {
  render: () =>
    solidStory(() => {
      const [visible, setVisible] = createSignal(true);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="Fixed layer" code="fixed" note="A full-viewport layer dims the story canvas; a frozen notice shows the open state.">
              <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
                {visible() ? "Hide layer" : "Show layer"}
              </Button>
            </Specimen>
            <Specimen title="Backdrop content" note="Real panel copy behind the layer.">
              <BackdropContent />
            </Specimen>
          </SpecimenGrid>
          <Show when={visible()}>
            <Overlay fixed center opacity={0.55} zIndex={20}>
              <FrozenCard title="Viewport notice" body="Feed reconnected · quotes are live again." />
            </Overlay>
          </Show>
        </Page>
      );
    }),
};
