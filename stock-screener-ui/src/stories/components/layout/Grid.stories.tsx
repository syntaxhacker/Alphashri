import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Grid, GridCol, Stack, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Grid",
  tags: ["autodocs"],
  component: asStoryComponent(Grid),
  parameters: {
    docs: {
      description: {
        component:
          "Grid is an explicit track grid: repeat(cols, minmax(0,1fr)) with numeric/8pt gaps. cols defaults to 12; columns/gutter are legacy aliases. rows sets explicit equal rows; flow='col' fills top-to-bottom instead of left-to-right. GridCol writes a real grid-column: span N, offset N (grid-column-start = N+1) and order. span='auto'/'content' leave grid-column unset for auto-placement.",
      },
    },
  },
  argTypes: {
    cols: arg.cols,
    gap: arg.gap,
    gutter: arg.gap,
    rows: arg.cols,
    flow: { control: "select", options: ["row", "col"], description: "grid-auto-flow direction" },
  },
};
export default meta;
type Story = StoryObj;

const ruler = (gap: number | string) => (
  <Grid cols={12} gap={gap} style={{ "margin-bottom": "6px" }}>
    {Array.from({ length: 12 }, (_, i) => (
      <GridCol span={1}>
        <Box className="text-ui-micro" style={{ height: "20px", display: "grid", "place-items": "center", border: `1px solid ${C.border}`, background: C.alt, color: C.muted, "font-family": MONO }}>
          {i + 1}
        </Box>
      </GridCol>
    ))}
  </Grid>
);

export const Playground: Story = {
  args: {
    cols: 12,
    gap: 8,
    rows: undefined,
    flow: "row",
  },
  render: (args) =>
    solidStory(() => (
      <Stack gap="xs">
        {ruler(args.gap ?? 8)}
        <Grid {...args}>
          <GridCol span={4}><Tile label="span 4" sub="one third" h={56} tone={C.primary} /></GridCol>
          <GridCol span={8}><Tile label="span 8" sub="two thirds" h={56} tone={C.info} /></GridCol>
        </Grid>
      </Stack>
    )),
};

export const SpansAndOffsets: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Spans & offsets" caption="The numbered ruler marks all 12 tracks. Numeric span writes grid-column: span N / span N; offset writes grid-column-start = offset+1.">
          <Stack gap="lg">
            <Demo label="span 4 + span 8 on the same 12 tracks.">
              {ruler(8)}
              <Grid cols={12} gap={8}>
                <GridCol span={4}><Tile label="span 4" sub="cols 1-4" h={52} tone={C.primary} /></GridCol>
                <GridCol span={8}><Tile label="span 8" sub="cols 5-12" h={52} tone={C.info} /></GridCol>
              </Grid>
            </Demo>
            <Demo label="offset 0 / 4 / 8 pins three 4-wide cells to tracks 1-4, 5-8 and 9-12.">
              {ruler(8)}
              <Grid cols={12} gap={8}>
                <GridCol span={4} offset={0}><Tile label="offset 0" sub="cols 1-4" h={52} /></GridCol>
                <GridCol span={4} offset={4}><Tile label="offset 4" sub="cols 5-8" h={52} tone={C.primary} /></GridCol>
                <GridCol span={4} offset={8}><Tile label="offset 8" sub="cols 9-12" h={52} /></GridCol>
              </Grid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const OrderAndFlow: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Order & flow" caption="order reorders visually without changing DOM order. flow='col' fills a rows×cols matrix top-to-bottom, column by column.">
          <Stack gap="lg">
            <Demo label="DOM A/B/C with order 3/1/2 renders as B, C, A.">
              <Grid cols={12} gap={8}>
                <GridCol span={4} order={3}><Tile label="DOM A · order 3" sub="renders last" h={52} /></GridCol>
                <GridCol span={4} order={1}><Tile label="DOM B · order 1" sub="renders first" h={52} tone={C.primary} /></GridCol>
                <GridCol span={4} order={2}><Tile label="DOM C · order 2" sub="renders second" h={52} tone={C.info} /></GridCol>
              </Grid>
            </Demo>
            <Demo label="rows={2} + flow='col': a 4×2 matrix filled 1,2 in column 1 then 3,4 in column 2.">
              <Grid cols={4} rows={2} flow="col" gap={8}>
                {Array.from({ length: 8 }, (_, i) => (
                  <GridCol span={1}><Tile label={String(i + 1)} h={52} tone={i % 2 === 0 ? C.primary : C.border} /></GridCol>
                ))}
              </Grid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const GapAndNesting: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Gap & nesting" caption="Numeric gap is px; string tokens follow the 8pt ramp. A nested Grid defines its own track context inside a parent cell.">
          <Stack gap="lg">
            <Demo label="gap={4} vs gap={20} on the same two half-width cells.">
              <Stack gap="xs">
                {([4, 20] as const).map((g) => (
                  <Grid cols={12} gap={g}>
                    <GridCol span={6}><Tile label={`gap ${g} · span 6`} h={40} /></GridCol>
                    <GridCol span={6}><Tile label={`gap ${g} · span 6`} h={40} /></GridCol>
                  </Grid>
                ))}
              </Stack>
            </Demo>
            <Demo label="gutter='lg' is the legacy alias for gap (24px).">
              <Grid cols={12} gutter="lg">
                <GridCol span={6}><Tile label="gutter lg" h={40} tone={C.info} /></GridCol>
                <GridCol span={6}><Tile label="gutter lg" h={40} tone={C.info} /></GridCol>
              </Grid>
            </Demo>
            <Demo label="A nested 2-track Grid inside the outer span-8 cell.">
              <Grid cols={12} gap={8}>
                <GridCol span={8}>
                  <Box p="xs" style={{ border: `1px solid ${C.primary}`, "border-radius": "4px", background: C.surface }}>
                    <Note>outer cell · span 8</Note>
                    <Grid cols={2} gap={8} style={{ "margin-top": "6px" }}>
                      <GridCol span={1}><Tile label="nested 1/2" h={40} /></GridCol>
                      <GridCol span={1}><Tile label="nested 2/2" h={40} /></GridCol>
                    </Grid>
                  </Box>
                </GridCol>
                <GridCol span={4}><Tile label="outer span 4" h={104} tone={C.info} /></GridCol>
              </Grid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveGrid: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 1100px)");
      const cols = createMemo(() => (isWide() ? 12 : 6));
      const span = createMemo(() => (isWide() ? 4 : 3));
      return (
        <Page>
          <Section title="Responsive grid" caption="The caller switches the track count from a media query; GridCol spans are relative to that count. Resize across 1100px.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Note>{`cols=${cols()} · span=${span()}`}</Note>
              {ruler(8)}
              <Grid cols={cols()} gap={8}>
                <GridCol span={span()}><Tile label="A" h={48} tone={C.primary} /></GridCol>
                <GridCol span={span()}><Tile label="B" h={48} tone={C.info} /></GridCol>
                {cols() === 12 ? <GridCol span={4}><Tile label="C" h={48} /></GridCol> : null}
              </Grid>
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
        <Section title="Edge states" caption="span auto/content auto-place, columns legacy alias, overflowing spans wrap into implicit rows, and empty grids reserve nothing.">
          <Stack gap="lg">
            <Demo label="span='auto' and span='content' leave grid-column unset; a numeric span is explicit.">
              <Grid cols={12} gap={8}>
                <GridCol span="auto"><Tile label="span auto" h={40} /></GridCol>
                <GridCol span="content"><Tile label="span content" h={40} /></GridCol>
                <GridCol span={6}><Tile label="span 6" h={40} tone={C.primary} /></GridCol>
              </Grid>
            </Demo>
            <Demo label="columns={6} is the legacy alias for cols.">
              <Grid columns={6} gap={8}>
                {[1, 2, 3, 4, 5, 6].map((n) => <GridCol span={1}><Tile label={String(n)} h={36} /></GridCol>)}
              </Grid>
            </Demo>
            <Demo label="Three span-6 cells in a 12-track grid: the third overflows into an implicit second row.">
              <Grid cols={12} gap={8}>
                <GridCol span={6}><Tile label="1 · span 6" h={40} /></GridCol>
                <GridCol span={6}><Tile label="2 · span 6" h={40} /></GridCol>
                <GridCol span={6}><Tile label="3 · spans into row 2" h={40} tone={C.info} /></GridCol>
              </Grid>
            </Demo>
            <Demo label="Empty grid with a declared min-height.">
              <Grid cols={12} gap={8} style={{ "min-height": "28px", border: `1px dashed ${C.border}` }} />
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
