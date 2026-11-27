import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Flex, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Flex",
  tags: ["autodocs"],
  component: asStoryComponent(Flex),
  parameters: {
    docs: {
      description: {
        component:
          "Flex is a display:flex container with no default direction (CSS row). direction/wrap/justify/align map to flex-direction/flex-wrap/justify-content/align-items; gap accepts an 8pt token, a number in px or raw CSS. Unlike Group it does not force wrapping, and unlike Stack it does not force a column. spacing is the legacy alias for gap (number × 8px).",
      },
    },
  },
  argTypes: {
    direction: arg.direction,
    wrap: arg.wrapFlex,
    justify: arg.justifyFlex,
    align: arg.alignFlex,
    gap: arg.gap,
    spacing: arg.gap,
    p: arg.padding,
    bg: arg.bg,
    w: arg.width,
    h: arg.height,
    component: arg.component,
    flex: arg.textFlex,
  },
};
export default meta;
type Story = StoryObj;

const trio = () => (
  <>
    <Tile label="A" w={64} h={36} tone={C.primary} />
    <Tile label="B" w={64} h={36} tone={C.info} />
    <Tile label="C" w={64} h={36} />
  </>
);

export const Playground: Story = {
  args: {
    direction: "row",
    wrap: "wrap",
    justify: "flex-start",
    align: "center",
    gap: "sm",
    p: "sm",
  },
  render: (args) =>
    solidStory(() => (
      <Flex {...args} style={{ border: `1px solid ${C.border}`, background: C.surface }}>
        {trio()}
      </Flex>
    )),
};

export const Direction: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Direction" caption="All four flex-direction values over the same three children.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
            {(["row", "row-reverse", "column", "column-reverse"] as const).map((d) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`direction='${d}'`}</Note>
                <Flex direction={d} gap="xs" style={{ "margin-top": "8px" }}>
                  {trio()}
                </Flex>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const Justify: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Justification" caption="justify-content is only visible when the band has free space; each row is full width.">
          <Stack gap="xs">
            {(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] as const).map((j) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`justify='${j}'`}</Note>
                <Flex justify={j} gap="xs" style={{ "margin-top": "8px", "min-height": "36px" }}>
                  {trio()}
                </Flex>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const Alignment: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Alignment" caption="align-items over deliberately unequal children (28 / 56 / 40px). stretch drops their fixed heights; baseline aligns text baselines.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
            {(["flex-start", "center", "flex-end", "stretch", "baseline"] as const).map((a) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`align='${a}'`}</Note>
                <Flex align={a} gap="xs" style={{ "margin-top": "8px", "min-height": "72px" }}>
                  <Tile label="28" h={28} tone={C.primary} />
                  <Tile label="56" h={56} tone={C.info} />
                  <Tile label="40" h={40} />
                </Flex>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const GapScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Gap" caption="Named tokens resolve to 4/8/16/24/32px; a number is px. spacing is the legacy alias and is multiplied by 8 when numeric.">
          <Stack gap="md">
            <Demo label="gap = xs / sm / md / lg / xl, then 4 / 20 as raw numbers.">
              <Stack gap="xs">
                {([...(["xs", "sm", "md", "lg", "xl"] as const), 4, 20] as const).map((g) => (
                  <Box p="xs" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{typeof g === "number" ? `gap={${g}} → ${g}px` : `gap='${g}'`}</Note>
                    <Flex gap={g} style={{ "margin-top": "8px" }}>
                      {trio()}
                    </Flex>
                  </Box>
                ))}
              </Stack>
            </Demo>
            <Demo label="spacing={2} is the legacy alias: numeric spacing is multiplied by 8, so it produces a 16px gap.">
              <Flex spacing={2} style={{ border: `1px dashed ${C.border}`, padding: "8px" }}>
                {trio()}
              </Flex>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const WrapAndOverflow: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Wrapping & overflow" caption="wrap='wrap' (the Flex default is nowrap) moves extra children onto new lines. nowrap in a constrained host scrolls horizontally.">
          <Stack gap="md">
            <Demo label="Five 120px tiles in a 420px band: wrap='wrap' creates two lines.">
              <Box w={420} p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Flex wrap="wrap" gap="sm">
                  {["A", "B", "C", "D", "E"].map((n) => (
                    <Tile label={n} w={120} h={36} tone={C.primary} />
                  ))}
                </Flex>
              </Box>
            </Demo>
            <Demo label="wrap='nowrap' keeps one band; the host scrolls to reach the tail.">
              <Box w={420} style={{ overflow: "auto", border: `1px solid ${C.border}`, padding: "8px" }}>
                <Flex wrap="nowrap" gap="sm">
                  {["A", "B", "C", "D", "E"].map((n) => (
                    <Tile label={n} w={120} h={36} tone={C.info} />
                  ))}
                </Flex>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveFlex: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const direction = createMemo(() => (isWide() ? "row" : "column"));
      return (
        <Page>
          <Section title="Responsive direction" caption="Flex has no breakpoints of its own; the caller drives direction from useMediaQuery. Resize across 900px.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Note>{`direction = ${direction()}`}</Note>
              <Flex direction={direction()} gap="sm" style={{ "margin-top": "8px", border: `1px dashed ${C.border}`, padding: "8px" }}>
                {trio()}
              </Flex>
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
        <Section title="Edge states" caption="Empty container, a single flex-growing child, and long unbreakable content.">
          <Stack gap="md">
            <Demo label="No children: the flex container still occupies its declared height.">
              <Flex h={48} style={{ border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="flex='1' on one child absorbs the leftover space in a row.">
              <Flex gap="xs" style={{ width: "100%", "max-width": "480px" }}>
                <Tile label="fixed" w={96} h={40} />
                <Box flex="1" p="xs" bg={C.alt} style={{ border: `1px solid ${C.primary}` }}>
                  <Text size="xs" fs={MONO}>flex 1</Text>
                </Box>
              </Flex>
            </Demo>
            <Demo label="Long unbreakable text is clipped by the child's own overflow:hidden, not by Flex.">
              <Flex w={280} style={{ border: `1px solid ${C.info}` }}>
                <Box style={{ overflow: "hidden", "min-width": "0" }}>
                  <Text size="xs" fs={MONO} truncate>UNBREAKABLE_SYMBOL_WITH_A_VERY_LONG_NAME_1234567890</Text>
                </Box>
              </Flex>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
