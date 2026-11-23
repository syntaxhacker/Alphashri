import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import * as palette from "@/ui/palette";
import { solidStory } from "@/stories/solidStory";
import { Box, Paper, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, PAPER_RADIUS_PX, RADIUS_TOKENS,
  ResponsiveReadout, Section, SHADOW_STEPS,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Paper",
  tags: ["autodocs"],
  component: asStoryComponent(Paper),
  parameters: {
    docs: {
      description: {
        component:
          "Paper is a themed surface: bg-fin-surface by default, with an optional radius, elevation and padding. Its radius scale is the control-friendly xs 2 · sm 4 · md 6 · lg 10 · xl 14 px ramp. Named shadow steps reuse shadow-xs/sm/md/lg/xl utilities; an unrecognised shadow string is painted as raw CSS (e.g. palette.DIALOG_SHADOW). Default tag is section and can be switched through the intrinsic registry.",
      },
    },
  },
  argTypes: {
    p: arg.padding,
    px: arg.padding,
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
    p: "md",
    radius: "md",
    shadow: "sm",
    bg: "var(--color-fin-surface)",
    c: "var(--color-fin-text)",
    component: "section",
  },
  render: (args) =>
    solidStory(() => (
      <Paper {...args} style={{ "max-width": "480px", border: `1px solid ${C.border}` }}>
        <Text size="sm" fw={700} fs={MONO}>Paper · playground</Text>
        <Text size="xs" c={C.muted} fs={MONO}>padding md · radius md · shadow sm</Text>
      </Paper>
    )),
};

export const RadiusScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Radius" caption="Paper's documented radius ramp is xs 2 · sm 4 · md 6 · lg 10 · xl 14 px — deliberately smaller than Card's panel-scale ramp.">
          <div style={{ display: "grid", "grid-template-columns": `repeat(${RADIUS_TOKENS.length}, minmax(0,1fr))`, gap: "8px" }}>
            {RADIUS_TOKENS.map((r, i) => (
              <Box>
                <Paper p="sm" radius={r} shadow="xs" component="div" className="border border-fin-border" style={{ height: "56px", display: "grid", "place-items": "center" }}>
                  <Text size="sm" fw={700} fs={MONO}>{r}</Text>
                </Paper>
                <Note>{PAPER_RADIUS_PX[i]}</Note>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const ShadowScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Elevation" caption="Named steps map to Tailwind shadow utilities. An unnamed value is caller-owned raw CSS — here the app's single dialog shadow.">
          <Stack gap="md">
            <Demo label="shadow = xs / sm / md / lg / xl.">
              <div style={{ display: "grid", "grid-template-columns": `repeat(${SHADOW_STEPS.length}, minmax(0,1fr))`, gap: "8px" }}>
                {SHADOW_STEPS.map((s) => (
                  <Paper p="sm" radius="sm" shadow={s} component="article" className="border border-fin-border" style={{ height: "64px", display: "grid", "place-items": "center" }}>
                    <Text size="xs" fs={MONO}>{`shadow ${s}`}</Text>
                  </Paper>
                ))}
              </div>
            </Demo>
            <Demo label="shadow = palette.DIALOG_SHADOW (raw CSS stored once in palette.ts).">
              <Paper p="md" radius="sm" shadow={palette.DIALOG_SHADOW} className="border border-fin-border" style={{ "max-width": "420px" }}>
                <Text size="sm" fs={MONO}>shadow = palette.DIALOG_SHADOW</Text>
                <Note>0 8px 32px rgba — theme-owned, no literal here.</Note>
              </Paper>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const SurfacesAndPadding: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Surfaces & padding" caption="bg overrides the default surface; c sets text colour. Padding follows the sp() ramp (xs 4 · sm 8 · md 16 · lg 24 · xl 32).">
          <Stack gap="md">
            <Demo label="Theme backgrounds: page / surface / surface-alt.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                {([C.bg, C.surface, C.alt] as const).map((bg, i) => (
                  <Paper p="sm" radius="sm" bg={bg} component="div" style={{ height: "56px", display: "grid", "place-items": "center", border: `1px solid ${C.border}` }}>
                    <Text size="xs" fs={MONO}>{["bg", "surface", "surface-alt"][i]}</Text>
                  </Paper>
                ))}
              </div>
            </Demo>
            <Demo label="Padding xs → xl over the same child.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(5, minmax(0,1fr))", gap: "8px" }}>
                {(["xs", "sm", "md", "lg", "xl"] as const).map((p) => (
                  <Paper p={p} radius="sm" component="div" className="border border-fin-border">
                    <Box bg={C.alt} p="xs" className="text-ui-micro" style={{ "font-family": MONO }}>content</Box>
                    <Note>{`p='${p}'`}</Note>
                  </Paper>
                ))}
              </div>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const SemanticTags: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Semantic tags" caption="component switches the rendered element through Paper's intrinsic registry (div / section / article / aside / header / footer / main / form / figure).">
          <Stack gap="xs">
            {(["div", "section", "article", "aside", "header", "footer"] as const).map((tag) => (
              <Paper component={tag} p="sm" radius="sm" className="border border-fin-border">
                <Text size="xs" fs={MONO}>{`<${tag}>`}</Text>
              </Paper>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsivePaper: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const padding = createMemo(() => (isWide() ? "lg" : "sm"));
      return (
        <Page>
          <Section title="Responsive surface" caption="The caller switches padding from a media query; the surface keeps its radius and elevation.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Paper p={padding()} radius="md" shadow="md" className="border border-fin-border" style={{ "max-width": "100%" }}>
                <Text size="sm" fs={MONO}>{`p='${padding()}'`}</Text>
              </Paper>
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
        <Section title="Edge states" caption="Empty surface, long content with caller-owned scrolling, and an unknown component tag falling back to section.">
          <Stack gap="md">
            <Demo label="No children: padding alone reserves a 48px surface.">
              <Paper style={{ height: "48px" }} radius="sm" className="border border-fin-border" />
            </Demo>
            <Demo label="Long content: Paper does not clip; the caller adds overflow:auto and a max-height.">
              <Paper p="sm" radius="sm" style={{ "max-height": "96px", overflow: "auto", border: `1px solid ${C.info}` }}>
                <Stack gap="xs">
                  {Array.from({ length: 10 }, (_, i) => <Text size="xs" fs={MONO}>{`paper row ${i + 1}`}</Text>)}
                </Stack>
              </Paper>
            </Demo>
            <Demo label="An unknown component name falls back to the default section tag.">
              <Paper component="unknown" p="sm" radius="sm" className="border border-fin-border">
                <Text size="xs" fs={MONO}>component='unknown' → section</Text>
              </Paper>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
