import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Stack, Text, useMediaQuery } from "@/ui";
import { arg, asStoryComponent, C, Demo, MONO, Note, Page, Section, Tile } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Box",
  tags: ["autodocs"],
  component: asStoryComponent(Box),
  parameters: {
    docs: {
      description: {
        component:
          "Box is the generic layout primitive: a semantic tag plus spacing, sizing, background/text colour, opacity and positioning. It applies no display mode of its own; flex behaviour comes from Flex/Stack/Group or explicit style. Padding/margin accept 8pt tokens (xs 4 · sm 8 · md 16 · lg 24 · xl 32), numbers in px or raw CSS. w/h/miw/maw/mih/mah use the same number-as-px convention.",
      },
    },
  },
  argTypes: {
    p: arg.padding,
    px: arg.padding,
    py: arg.padding,
    m: arg.spacing,
    mx: arg.spacing,
    bg: arg.bg,
    c: arg.color,
    opacity: { control: { type: "range", min: 0, max: 1, step: 0.05 }, description: "opacity", table: { category: "Surface" } },
    pos: arg.selectPos,
    w: arg.width,
    h: arg.height,
    miw: arg.width,
    maw: arg.width,
    component: arg.component,
    flex: arg.textFlex,
    alignItems: arg.alignFlex,
    justifyContent: arg.justifyFlex,
    flexDirection: arg.direction,
    gap: arg.gap,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    p: "md",
    bg: "var(--color-fin-surface-alt)",
    c: "var(--color-fin-text)",
    w: 260,
    h: 96,
    pos: "relative",
    component: "div",
  },
  render: (args) =>
    solidStory(() => (
      <Box {...args} style={{ border: `1px solid ${C.primary}`, "border-radius": "6px" }}>
        <Text size="sm" fw={600} fs={MONO}>Box · playground</Text>
        <Text size="xs" c={C.muted} fs={MONO}>260 × 96 · padding 16</Text>
      </Box>
    )),
};

export const SpacingScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="Spacing"
          caption="p takes xs/sm/md/lg/xl (4/8/16/24/32px), a number in px, or raw CSS. px and py override only the matching axis; mx/my do the same for margins."
        >
          <Stack gap="md">
            <Demo label="p = xs / sm / md / lg / xl over an identical child.">
              <Stack gap="xs">
                {(["xs", "sm", "md", "lg", "xl"] as const).map((sz) => (
                  <Box p={sz} bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                    <Text size="xs" fs={MONO}>{`p='${sz}'`}</Text>
                  </Box>
                ))}
              </Stack>
            </Demo>
            <Demo label="px='lg' py='xs' — horizontal padding 24px, vertical padding 4px.">
              <Box px="lg" py="xs" bg={C.alt} style={{ border: `1px solid ${C.info}` }}>
                <Text size="xs" fs={MONO}>px lg · py xs</Text>
              </Box>
            </Demo>
            <Demo label="mt/mb/mx margins: each box has the same padding but a different outer margin against the dashed frame.">
              <Box style={{ border: `1px dashed ${C.border}` }}>
                <Box mt="lg" mb="xs" mx="md" p="xs" bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                  <Text size="xs" fs={MONO}>mt lg · mb xs · mx md</Text>
                </Box>
              </Box>
            </Demo>
            <Demo label="numeric padding is px: p={8} and spacing='md' both resolve to 16px via the 8pt ramp on string tokens.">
              <Stack gap="xs">
                <Box p={8} bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                  <Text size="xs" fs={MONO}>p={'{8}'} → 8px padding</Text>
                </Box>
                <Box gap="md" bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                  <Text size="xs" fs={MONO}>gap='md' → 16px gap (inline style overrides)</Text>
                </Box>
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const SizingAndOverflow: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="Sizing & overflow"
          caption="w/h/miw/maw/mih/mah turn a number into px. Overflow is caller-owned CSS on style — Box never sets it."
        >
          <Stack gap="md">
            <Demo label="miw=320 maw=440: the box grows with its container until 440px, then stops. Resize the canvas to see the clamp.">
              <Box miw={320} maw={440} p="sm" bg={C.alt} style={{ border: `1px solid ${C.primary}` }}>
                <Text size="xs" fs={MONO}>min-width 320 · max-width 440</Text>
              </Box>
            </Demo>
            <Demo label="h=96 mah=64: the explicit max-height wins, so content taller than 64px is clipped by the caller's overflow.">
              <Box h={96} mah={64} p="sm" style={{ overflow: "auto", border: `1px solid ${C.info}`, background: C.surface }}>
                <Stack gap="xs">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Text size="xs" fs={MONO}>{`clipped row ${i + 1}`}</Text>
                  ))}
                </Stack>
              </Box>
            </Demo>
            <Demo label="flex={1} makes a Box absorb free space when it sits inside a Flex/Stack row.">
              <Stack direction="row" gap="xs" style={{ width: "100%", "max-width": "520px" }}>
                <Tile label="fixed 96" w={96} h={40} />
                <Box flex="1" p="xs" bg={C.alt} style={{ border: `1px solid ${C.primary}` }}>
                  <Text size="xs" fs={MONO}>flex 1</Text>
                </Box>
                <Tile label="fixed 96" w={96} h={40} />
              </Stack>
            </Demo>
            <Demo label="opacity reduces the whole subtree, including the border and background.">
              <Stack gap="xs">
                {([1, 0.6, 0.25] as const).map((o) => (
                  <Box opacity={o} p="xs" bg={C.alt} style={{ border: `1px solid ${C.primary}` }}>
                    <Text size="xs" fs={MONO}>{`opacity ${o}`}</Text>
                  </Box>
                ))}
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const Alignment: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Flex props on Box" caption="Box also accepts alignItems / justifyContent / flexDirection / gap / spacing. It does not set display:flex itself, so the caller supplies that via style.">
          <Stack gap="md">
            {([["flex-start", "flex-start"], ["center", "space-between"], ["flex-end", "flex-end"]] as const).map(([align, justify]) => (
              <Box style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`alignItems='${align}' · justifyContent='${justify}'`}</Note>
                <Box
                  alignItems={align}
                  justifyContent={justify}
                  gap="xs"
                  style={{ display: "flex", "min-height": "52px", padding: "8px", "margin-top": "8px" }}
                >
                  <Tile label="A" w={56} h={28} tone={C.primary} />
                  <Tile label="B" w={56} h={28} tone={C.info} />
                  <Tile label="C" w={56} h={28} />
                </Box>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const Positioning: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="Positioning & semantic tags"
          caption="pos plus top/right/bottom/left/inset set CSS positioning. component switches the rendered tag through Box's intrinsic registry."
        >
          <Stack gap="md">
            <Demo label="pos='relative' with an absolutely positioned tag pinned at top=8 right=8.">
              <Box pos="relative" p="md" h={96} bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                <Text size="sm" fs={MONO}>position: relative</Text>
                <Box pos="absolute" top={8} right={8} px="xs" py="xs" bg={C.primary} c={C.bg} className="text-ui-micro" style={{ "font-family": MONO, "border-radius": "2px" }}>
                  absolute 8/8
                </Box>
              </Box>
            </Demo>
            <Demo label="inset=0 stretches an overlay over its positioned parent.">
              <Box pos="relative" p="md" h={80} bg={C.surface} style={{ border: `1px solid ${C.border}` }}>
                <Text size="sm" fs={MONO}>relative host</Text>
                <Box pos="absolute" inset={0} style={{ background: "color-mix(in srgb, var(--color-fin-info) 14%, transparent)" }} />
              </Box>
            </Demo>
            <Demo label="component renders a real semantic element (aside / section / article / header) — inspect the DOM to confirm the tag.">
              <Stack gap="xs">
                {(["aside", "section", "article", "header"] as const).map((tag) => (
                  <Box component={tag} p="xs" bg={C.alt} style={{ border: `1px solid ${C.info}` }}>
                    <Text size="xs" fs={MONO}>{`<${tag}>`}</Text>
                  </Box>
                ))}
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveBox: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const width = createMemo(() => (isWide() ? 480 : 240));
      return (
        <Page>
          <Section title="Responsive sizing" caption="Box itself has no breakpoints; the caller drives w from useMediaQuery. Resize the canvas across 900px.">
            <Stack gap="xs">
              <Note>{`canvas → w=${width()}px (900px breakpoint)`}</Note>
              <ResponsiveProbe />
              <Box w={width()} p="md" bg={C.alt} style={{ border: `1px solid ${C.primary}`, "max-width": "100%" }}>
                <Text size="sm" fs={MONO}>{`w = ${width()}px`}</Text>
              </Box>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

const ResponsiveProbe = () => {
  const sm = useMediaQuery("(min-width: 640px)");
  const lg = useMediaQuery("(min-width: 1024px)");
  const label = createMemo(() => (lg() ? "lg" : sm() ? "sm" : "base"));
  return <Note>{`matchMedia branch: ${label()}`}</Note>;
};

export const EdgeStates: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Edge states" caption="Empty content, unknown component tags and unitless-zero style values.">
          <Stack gap="md">
            <Demo label="No children: padding still reserves space; the box is an empty 48px shell.">
              <Box h={48} p="sm" bg={C.surface} style={{ border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="An unknown component name falls back to div (documented registry behaviour).">
              <Box component="not-a-tag" p="xs" bg={C.alt} style={{ border: `1px solid ${C.border}` }}>
                <Text size="xs" fs={MONO}>component='not-a-tag' → div</Text>
              </Box>
            </Demo>
            <Demo label="Numeric zero in style stays unitless (legal CSS); other numbers gain px.">
              <Box style={{ top: 0, left: "8px", position: "relative", border: `1px solid ${C.info}`, padding: "8px" }}>
                <Text size="xs" fs={MONO}>top 0 · left 8px</Text>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
