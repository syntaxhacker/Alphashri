import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Divider, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Stack",
  tags: ["autodocs"],
  component: asStoryComponent(Stack),
  parameters: {
    docs: {
      description: {
        component:
          "Stack is a flex column by default (display:flex + flex-direction:column). It inherits Flex's spacing and alignment props; direction='row' turns it into a horizontal stack. gap/spacing share the same 8pt-token / px / raw-CSS resolution as Flex.",
      },
    },
  },
  argTypes: {
    direction: arg.direction,
    gap: arg.gap,
    spacing: arg.gap,
    align: arg.alignFlex,
    justify: arg.justifyFlex,
    wrap: arg.wrapFlex,
    p: arg.padding,
    bg: arg.bg,
    h: arg.height,
    w: arg.width,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    direction: "column",
    gap: "sm",
    align: "stretch",
    justify: "flex-start",
    p: "sm",
  },
  render: (args) =>
    solidStory(() => (
      <Stack {...args} style={{ border: `1px solid ${C.border}`, background: C.surface }}>
        <Tile label="row 1" h={36} tone={C.primary} />
        <Tile label="row 2" h={36} tone={C.info} />
        <Tile label="row 3" h={36} />
      </Stack>
    )),
};

export const GapScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Gap" caption="Stack's default column direction makes gap a vertical rhythm. Named tokens are 4/8/16/24/32px.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "16px" }}>
            {([...(["xs", "sm", "md", "lg", "xl"] as const), 24] as const).map((g) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{typeof g === "number" ? `gap={${g}} → 24px` : `gap='${g}'`}</Note>
                <Stack gap={g} style={{ "margin-top": "8px" }}>
                  <Tile label="1" h={28} />
                  <Tile label="2" h={28} />
                  <Tile label="3" h={28} />
                </Stack>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const DirectionAndAlignment: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Direction & alignment" caption="direction='row' makes a horizontal stack. In a column, justify controls vertical distribution and align controls the cross axis.">
          <Stack gap="md">
            <Demo label="Default column vs direction='row' over the same two children.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
                <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                  <Note>column (default)</Note>
                  <Stack gap="xs" style={{ "margin-top": "8px" }}>
                    <Tile label="1" h={36} />
                    <Tile label="2" h={36} />
                  </Stack>
                </Box>
                <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                  <Note>direction='row'</Note>
                  <Stack direction="row" gap="xs" style={{ "margin-top": "8px" }}>
                    <Tile label="1" h={36} grow="1" />
                    <Tile label="2" h={36} grow="1" />
                  </Stack>
                </Box>
              </div>
            </Demo>
            <Demo label="justify in a fixed-height column: flex-start / center / flex-end / space-between.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(4, minmax(0,1fr))", gap: "8px" }}>
                {(["flex-start", "center", "flex-end", "space-between"] as const).map((j) => (
                  <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{`justify='${j}'`}</Note>
                    <Stack justify={j} gap="xs" h={120} style={{ "margin-top": "8px" }}>
                      <Tile label="A" h={28} tone={C.primary} />
                      <Tile label="B" h={28} tone={C.info} />
                    </Stack>
                  </Box>
                ))}
              </div>
            </Demo>
            <Demo label="align in a column: flex-start leaves children at their natural width; stretch (default) fills the cross axis.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                {(["flex-start", "center", "stretch"] as const).map((a) => (
                  <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{`align='${a}'`}</Note>
                    <Stack align={a} gap="xs" style={{ "margin-top": "8px" }}>
                      <Tile label="short" h={28} />
                      <Tile label="wide content here" h={28} />
                    </Stack>
                  </Box>
                ))}
              </div>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const DividedStack: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Divided content" caption="A vertical Stack is the natural place for a labelled horizontal Divider between sections.">
          <Stack gap="sm" p="md" bg={C.surface} style={{ border: `1px solid ${C.border}`, "border-radius": "6px" }}>
            <Text size="sm" fw={700} fs={MONO}>Session summary</Text>
            <Text size="xs" c={C.muted} fs={MONO}>NIFTY · 15m · 24,810.40</Text>
            <Divider label="positions" labelPosition="center" />
            <Tile label="RELIANCE" sub="15m · ascending triangle" h={48} tone={C.primary} />
            <Divider />
            <Tile label="HDFCBANK" sub="1h · flag retest" h={48} tone={C.info} />
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveStack: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const direction = createMemo(() => (isWide() ? "row" : "column"));
      const gap = createMemo(() => (isWide() ? "md" : "xs"));
      return (
        <Page>
          <Section title="Responsive stack" caption="The caller switches direction and gap from live media queries. Resize across 900px.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Note>{`direction=${direction()} · gap=${gap()}`}</Note>
              <Stack direction={direction()} gap={gap()} style={{ "margin-top": "8px" }}>
                <Tile label="panel A" h={56} tone={C.primary} grow="1" />
                <Tile label="panel B" h={56} tone={C.info} grow="1" />
                <Tile label="panel C" h={56} grow="1" />
              </Stack>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const OverflowAndEdges: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Overflow & edge states" caption="A fixed-height Stack with many children needs a caller-owned scroll container. Empty and single-child stacks are also shown.">
          <Stack gap="md">
            <Demo label="h=140 with overflow:auto on style: nine 36px rows scroll inside the stack.">
              <Stack h={140} gap="xs" style={{ overflow: "auto", border: `1px solid ${C.border}`, padding: "8px" }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <Tile label={`row ${i + 1}`} h={36} />
                ))}
              </Stack>
            </Demo>
            <Demo label="No children: declared height is still reserved.">
              <Stack h={40} style={{ border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="One child with align='center': the child keeps its natural width in a full-width column.">
              <Stack align="center" gap="xs" style={{ border: `1px solid ${C.info}`, padding: "8px" }}>
                <Tile label="centered" w={140} h={36} />
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
