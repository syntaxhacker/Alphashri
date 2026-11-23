import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Badge, Box, Card, Divider, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, CARD_RADIUS_PX, C, Demo, MONO, Note, Page, RADIUS_TOKENS,
  ResponsiveReadout, Section,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Card",
  tags: ["autodocs"],
  component: asStoryComponent(Card),
  parameters: {
    docs: {
      description: {
        component:
          "Card is a themed panel built for content, with the same surface as Paper but a larger radius ramp: xs 4 · sm 8 · md 16 · lg 24 · xl 32 px. Inset uses padding (p is a fallback alias). It renders article by default. The shadow prop is accepted for API compatibility but is not applied — elevation is supplied by a Tailwind shadow-* className or an inline boxShadow. Avoid nesting bordered cards; separate sections with Divider instead.",
      },
    },
  },
  argTypes: {
    padding: arg.padding,
    p: arg.padding,
    radius: arg.radius,
    shadow: arg.shadow,
    bg: arg.bg,
    c: arg.color,
    w: arg.width,
    h: arg.height,
    component: arg.component,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    padding: "md",
    radius: "md",
    bg: "var(--color-fin-surface)",
    component: "article",
  },
  render: (args) =>
    solidStory(() => (
      <Card {...args} style={{ "max-width": "440px", border: `1px solid ${C.border}` }} className="shadow-md">
        <Text size="sm" fw={700} fs={MONO}>Card · playground</Text>
        <Text size="xs" c={C.muted} fs={MONO}>padding md · radius md · elevation from className</Text>
      </Card>
    )),
};

export const RadiusScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Radius" caption="Card's ramp is one full step larger than Paper's at every name: xs 4 · sm 8 · md 16 · lg 24 · xl 32 px.">
          <div style={{ display: "grid", "grid-template-columns": `repeat(${RADIUS_TOKENS.length}, minmax(0,1fr))`, gap: "8px" }}>
            {RADIUS_TOKENS.map((r, i) => (
              <Box>
                <Card padding="sm" radius={r} className="border border-fin-border h-14 grid place-items-center">
                  <Text size="sm" fw={700} fs={MONO}>{r}</Text>
                </Card>
                <Note>{CARD_RADIUS_PX[i]}</Note>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const PaddingScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Padding" caption="padding follows the sp() ramp: xs 4 · sm 8 · md 16 · lg 24 · xl 32 px. p remains as a fallback alias.">
          <div style={{ display: "grid", "grid-template-columns": `repeat(${RADIUS_TOKENS.length}, minmax(0,1fr))`, gap: "8px" }}>
            {(["xs", "sm", "md", "lg", "xl"] as const).map((sz) => (
              <Box>
                <Card padding={sz} radius="sm" component="article" className="border border-fin-border">
                  <Box bg={C.alt} p="xs" className="text-ui-micro" style={{ "font-family": MONO }}>content</Box>
                </Card>
                <Note>{`padding='${sz}'`}</Note>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Composition" caption="One bordered card with internal Dividers instead of nested bordered cards — the fin-app rule.">
          <Card padding="md" radius="md" className="border border-fin-border shadow-sm" style={{ "max-width": "520px" }}>
            <Stack gap="xs">
              <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "8px" }}>
                <Text size="sm" fw={700} fs={MONO}>RELIANCE · 15m</Text>
                <Badge size="xs" color="success">score 94</Badge>
              </div>
              <Text size="xs" c={C.muted} fs={MONO}>Ascending triangle · breakout above R1</Text>
              <Divider label="levels" labelPosition="center" />
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                {[["entry", "2,484.10"], ["target", "2,520.00"], ["stop", "2,462.00"]].map(([label, value]) => (
                  <Box p="xs" bg={C.alt} style={{ "border-radius": "4px" }}>
                    <Text size="xs" c={C.muted} fs={MONO}>{label}</Text>
                    <Text size="sm" fw={600} fs={MONO}>{value}</Text>
                  </Box>
                ))}
              </div>
              <Divider />
              <Text size="xs" c={C.muted} fs={MONO}>As of 15:00 IST · 1h candle closed</Text>
            </Stack>
          </Card>
        </Section>
      </Page>
    )),
};

export const Elevation: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Elevation" caption="shadow is accepted but voided by Card. Elevation comes from Tailwind shadow-* utilities via className, or an inline boxShadow.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "12px" }}>
            {([["none", ""], ["shadow-sm", "shadow-sm"], ["shadow-lg", "shadow-lg"]] as const).map(([label, cls]) => (
              <Card padding="md" radius="sm" className={`border border-fin-border ${cls}`} style={{ height: "72px", display: "grid", "place-items": "center" }}>
                <Text size="xs" fs={MONO}>{label}</Text>
              </Card>
            ))}
          </div>
          <Note>{`shadow='lg' is accepted but has no visual effect; className 'shadow-lg' above is the real elevation.`}</Note>
        </Section>
      </Page>
    )),
};

export const SurfacesAndResponsive: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const padding = createMemo(() => (isWide() ? "lg" : "sm"));
      return (
        <Page>
          <Section title="Surfaces & responsive" caption="bg overrides the themed surface. The caller switches padding from a media query.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "8px" }}>
                {([C.surface, C.alt] as const).map((bg, i) => (
                  <Card bg={bg} padding={padding()} radius="md" className="border border-fin-border" style={{ "max-width": "100%" }}>
                    <Text size="sm" fs={MONO}>{i === 0 ? "surface" : "surface-alt"}</Text>
                    <Note>{`padding='${padding()}'`}</Note>
                  </Card>
                ))}
              </div>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const EdgeStates: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Edge states" caption="Empty card, an unknown tag falling back to article, and long content with caller-owned scrolling.">
          <Stack gap="md">
            <Demo label="No children: padding alone reserves a 48px panel.">
              <Card style={{ height: "48px" }} radius="sm" className="border border-fin-border" />
            </Demo>
            <Demo label="component='unknown' falls back to article.">
              <Card component="unknown" padding="sm" radius="sm" className="border border-fin-border">
                <Text size="xs" fs={MONO}>unknown → article</Text>
              </Card>
            </Demo>
            <Demo label="Long content: max-height and overflow are caller-owned.">
              <Card padding="sm" radius="sm" style={{ "max-height": "96px", overflow: "auto", border: `1px solid ${C.info}` }}>
                <Stack gap="xs">
                  {Array.from({ length: 10 }, (_, i) => <Text size="xs" fs={MONO}>{`card row ${i + 1}`}</Text>)}
                </Stack>
              </Card>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
