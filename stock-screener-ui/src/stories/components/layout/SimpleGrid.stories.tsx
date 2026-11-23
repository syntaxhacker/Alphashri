import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, SimpleGrid, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/SimpleGrid",
  tags: ["autodocs"],
  component: asStoryComponent(SimpleGrid),
  parameters: {
    docs: {
      description: {
        component:
          "SimpleGrid renders repeat(cols, minmax(0,1fr)) equal columns with numeric/8pt gaps. cols defaults to 1 when omitted. spacing sets both gaps; verticalSpacing overrides only row-gap. It has no breakpoints of its own — responsive column counts are driven by useMediaQuery in the caller (the same pattern as PatternGrid).",
      },
    },
  },
  argTypes: {
    cols: arg.cols,
    spacing: arg.gap,
    verticalSpacing: arg.gap,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    cols: 3,
    spacing: "sm",
    verticalSpacing: "md",
  },
  render: (args) =>
    solidStory(() => (
      <SimpleGrid {...args}>
        {Array.from({ length: 6 }, (_, i) => (
          <Tile label={`card ${i + 1}`} sub="gap-x sm · gap-y md" h={56} tone={i % 2 === 0 ? C.primary : C.border} />
        ))}
      </SimpleGrid>
    )),
};

export const ColumnCounts: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Columns" caption="1 / 2 / 3 / 4 equal columns. Each track is minmax(0,1fr), so long content cannot push a column wider than its share.">
          <Stack gap="md">
            {([1, 2, 3, 4] as const).map((cols) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`cols={${cols}}`}</Note>
                <SimpleGrid cols={cols} spacing="xs" style={{ "margin-top": "8px" }}>
                  {Array.from({ length: Math.max(cols, 4) }, (_, i) => (
                    <Tile label={String(i + 1)} h={40} tone={i === 0 ? C.primary : C.border} />
                  ))}
                </SimpleGrid>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const Spacing: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Gaps" caption="spacing sets both axes; verticalSpacing overrides row-gap only. Named tokens are 4/8/16/24/32px; numbers are px.">
          <Stack gap="md">
            <Demo label="spacing={8} with no verticalSpacing: both gaps are 8px.">
              <SimpleGrid cols={3} spacing={8}>
                {Array.from({ length: 6 }, (_, i) => <Tile label={`cell ${i + 1}`} h={40} />)}
              </SimpleGrid>
            </Demo>
            <Demo label="spacing={8} verticalSpacing={24}: columns stay tight, rows breathe.">
              <SimpleGrid cols={3} spacing={8} verticalSpacing={24}>
                {Array.from({ length: 6 }, (_, i) => <Tile label={`cell ${i + 1}`} h={40} tone={C.info} />)}
              </SimpleGrid>
            </Demo>
            <Demo label="No spacing prop: cells touch.">
              <SimpleGrid cols={3}>
                {Array.from({ length: 3 }, (_, i) => <Tile label={`cell ${i + 1}`} h={40} />)}
              </SimpleGrid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveColumns: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 1400px)");
      const isDesktop = useMediaQuery("(min-width: 1200px)");
      const isTablet = useMediaQuery("(min-width: 900px)");
      const cols = createMemo(() => (isWide() ? 4 : isDesktop() ? 3 : isTablet() ? 2 : 1));
      return (
        <Page>
          <Section title="Responsive columns" caption="4 / 3 / 2 / 1 from the canvas width, using the same hook pattern as PatternGrid. Resize across 900 / 1200 / 1400px.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Note>{`active cols = ${cols()}`}</Note>
              <SimpleGrid cols={cols()} spacing="xs" verticalSpacing="sm" style={{ "margin-top": "8px" }}>
                {Array.from({ length: 4 }, (_, i) => (
                  <Box p="sm" style={{ border: `1px solid ${C.primary}`, background: C.surface }}>
                    <Text size="xs" fs={MONO}>{`card ${i + 1}`}</Text>
                  </Box>
                ))}
              </SimpleGrid>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const RowHeightsAndEdges: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Row heights & edge states" caption="Grid rows stretch to the tallest cell; no children and single children behave like a one-track grid.">
          <Stack gap="md">
            <Demo label="Unequal content: every cell in a row stretches to the tallest sibling.">
              <SimpleGrid cols={3} spacing="xs">
                <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface, height: "88px" }}>
                  <Text size="xs" fs={MONO}>tall cell</Text>
                </Box>
                <Box p="sm" style={{ border: `1px solid ${C.info}`, background: C.surface }}>
                  <Text size="xs" fs={MONO}>short cell (stretched)</Text>
                </Box>
                <Tile label="fixed-height tile" h={40} />
              </SimpleGrid>
            </Demo>
            <Demo label="cols omitted: defaults to one column, so children stack.">
              <SimpleGrid>
                <Tile label="stacked 1" h={36} />
                <Tile label="stacked 2" h={36} />
              </SimpleGrid>
            </Demo>
            <Demo label="No children: an empty grid reserves no space.">
              <SimpleGrid cols={4} style={{ "min-height": "32px", border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="Overflow: minmax(0,1fr) keeps long text from widening the track; the child truncates.">
              <SimpleGrid cols={2} spacing="xs">
                <Box style={{ "min-width": "0", border: `1px solid ${C.border}` }}>
                  <Text size="xs" fs={MONO} truncate>UNBREAKABLE_SYMBOL_WITH_A_VERY_LONG_NAME_1234567890</Text>
                </Box>
                <Tile label="normal" h={36} />
              </SimpleGrid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
