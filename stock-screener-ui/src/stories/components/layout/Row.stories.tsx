import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Col, Row, Stack, Text } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Row",
  tags: ["autodocs"],
  component: asStoryComponent(Row),
  parameters: {
    docs: {
      description: {
        component:
          "Row is a 12-track grid by default (cols is configurable). wrap=true gives overflowing spans implicit rows; wrap=false becomes a single max-content band where justify-content has a visible effect. Col carries base span plus sm/md/lg responsive spans, visual order and align-self. Spans are clamped to 1-12.",
      },
    },
  },
  argTypes: {
    cols: arg.cols,
    gap: arg.gap,
    align: arg.alignRow,
    justify: arg.justifyRow,
    wrap: arg.wrapBool,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    cols: 12,
    gap: 8,
    align: "stretch",
    justify: "start",
    wrap: true,
  },
  render: (args) =>
    solidStory(() => (
      <Row {...args}>
        <Col span={4}><Tile label="span 4" h={56} tone={C.primary} /></Col>
        <Col span={8}><Tile label="span 8" h={56} tone={C.info} /></Col>
      </Row>
    )),
};

export const ColumnCountsAndSpans: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Tracks & spans" caption="cols={6} divides the row into six tracks, so span 3 fills half. Default cols is 12.">
          <Stack gap="md">
            <Demo label="cols={6}: two span-3 cells fill the row.">
              <Row cols={6} gap="xs">
                <Col span={3}><Tile label="span 3 of 6" h={44} tone={C.primary} /></Col>
                <Col span={3}><Tile label="span 3 of 6" h={44} tone={C.info} /></Col>
              </Row>
            </Demo>
            <Demo label="Default cols=12: 6/3/3 fills one row.">
              <Row gap="xs">
                <Col span={6}><Tile label="span 6" h={44} /></Col>
                <Col span={3}><Tile label="span 3" h={44} tone={C.primary} /></Col>
                <Col span={3}><Tile label="span 3" h={44} tone={C.info} /></Col>
              </Row>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const Justification: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Justification" caption="On wrap={false} rows the grid becomes a max-content band, leaving free space so justify-content is visible. On a full-width wrapped grid it has no effect.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
            {(["start", "center", "end", "between", "around", "evenly"] as const).map((j) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`justify='${j}' · wrap={false}`}</Note>
                <Row wrap={false} gap="xs" justify={j} style={{ "margin-top": "8px" }}>
                  {["A", "B", "C"].map((n) => <Col><Tile label={n} w={56} h={28} tone={C.primary} /></Col>)}
                </Row>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const Alignment: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Alignment" caption="All Row align values over deliberately unequal children (28/56/40px), plus per-Col align-self.">
          <Stack gap="md">
            <Demo label="align on the Row: stretch drops the fixed heights; baseline aligns text baselines.">
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                {(["start", "center", "end", "stretch", "baseline"] as const).map((a) => (
                  <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{`align='${a}'`}</Note>
                    <Row gap="xs" align={a} style={{ "margin-top": "8px", "min-height": "72px" }}>
                      <Col span={4}><Tile label="28" h={a === "stretch" ? undefined : 28} tone={C.primary} /></Col>
                      <Col span={4}><Tile label="56" h={a === "stretch" ? undefined : 56} tone={C.info} /></Col>
                      <Col span={4}><Tile label="40" h={a === "stretch" ? undefined : 40} /></Col>
                    </Row>
                  </Box>
                ))}
              </div>
            </Demo>
            <Demo label="Col align: DOM A/B/C each align independently inside an 88px row.">
              <Row gap="xs" align="start" style={{ "min-height": "88px" }}>
                <Col span={4} align="start"><Tile label="A · start" h={28} tone={C.primary} /></Col>
                <Col span={4} align="center"><Tile label="B · center" h={28} tone={C.info} /></Col>
                <Col span={4} align="end"><Tile label="C · end" h={28} /></Col>
              </Row>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveSpans: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Responsive spans" caption="Col base=12 → sm=6 → md=4 → lg=3. Resize the canvas; the readout shows the active breakpoint.">
          <Stack gap="xs">
            <ResponsiveReadout />
            <Row gap="xs" style={{ "margin-top": "8px" }}>
              {["A", "B", "C", "D"].map((n) => (
                <Col span={12} sm={6} md={4} lg={3}>
                  <Tile label={n} sub="12 → 6 → 4 → 3" h={52} tone={C.primary} />
                </Col>
              ))}
            </Row>
          </Stack>
        </Section>
      </Page>
    )),
};

export const Mobile390: Story = {
  globals: { viewport: "mobile1" },
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
      options: { mobile1: { name: "Handset 390", styles: { width: "390px", height: "844px" }, type: "mobile" } },
    },
  },
  render: () =>
    solidStory(() => (
      <Box w={390} p="md" style={{ "max-width": "100%", background: C.surface, border: `1px solid ${C.border}` }}>
        <Stack gap="md">
          <Note>Pinned to 390px — base spans apply, responsive spans stay stacked.</Note>
          <Row gap="xs">
            <Col span={6}><Tile label="span 6" h={44} tone={C.primary} /></Col>
            <Col span={6}><Tile label="span 6" h={44} tone={C.info} /></Col>
          </Row>
          <Row gap="xs">
            <Col span={12} sm={6} md={4} lg={3}><Tile label="A · 12→6→4→3" h={44} /></Col>
            <Col span={12} sm={6} md={4} lg={3}><Tile label="B · 12→6→4→3" h={44} /></Col>
          </Row>
          <Note>ToolbarRow-style band: wrap=false scrolls instead of stacking.</Note>
          <Box style={{ overflow: "auto", border: `1px dashed ${C.border}`, padding: "8px" }}>
            <Row wrap={false} gap="xs">
              {[1, 2, 3, 4].map((n) => <Col><Tile label={`item ${n}`} w={160} h={40} /></Col>)}
            </Row>
          </Box>
        </Stack>
      </Box>
    )),
};

export const WrappingAndOverflow: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Wrapping & overflow" caption="Wrapped rows push overflowing spans into implicit rows; unwrapped rows stay a single max-content band that scrolls.">
          <Stack gap="md">
            <Demo label="wrap=true (default): three span-6 cells need 18 tracks, so the third drops to row 2.">
              <Row gap="xs">
                <Col span={6}><Tile label="1 · span 6" h={40} /></Col>
                <Col span={6}><Tile label="2 · span 6" h={40} /></Col>
                <Col span={6}><Tile label="3 · span 6 → row 2" h={40} tone={C.info} /></Col>
              </Row>
            </Demo>
            <Demo label="wrap={false}: four 160px Cols in a 420px host scroll horizontally.">
              <Box w={420} style={{ overflow: "auto", border: `1px solid ${C.border}`, padding: "8px" }}>
                <Row wrap={false} gap="xs">
                  {[1, 2, 3, 4].map((n) => <Col><Tile label={`item ${n}`} w={160} h={40} /></Col>)}
                </Row>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const EdgeStates: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Edge states" caption="Col spans are clamped to 1-12, order reorders visually, and an empty row reserves nothing.">
          <Stack gap="md">
            <Demo label="order on Col: DOM A/B/C renders as C (1), A (2), B (3).">
              <Row gap="xs">
                <Col span={4} order={2}><Tile label="DOM A · order 2" h={40} /></Col>
                <Col span={4} order={3}><Tile label="DOM B · order 3" h={40} /></Col>
                <Col span={4} order={1}><Tile label="DOM C · order 1" h={40} tone={C.primary} /></Col>
              </Row>
            </Demo>
            <Demo label="Out-of-range spans clamp: span={0} → 1, span={99} → 12.">
              <Row gap="xs">
                <Col span={0}><Box p="xs" bg={C.alt} style={{ border: `1px solid ${C.info}` }}><Text size="xs" fs={MONO}>span 0 → 1</Text></Box></Col>
                <Col span={99}><Box p="xs" bg={C.alt} style={{ border: `1px solid ${C.info}` }}><Text size="xs" fs={MONO}>span 99 → 12</Text></Box></Col>
              </Row>
            </Demo>
            <Demo label="No children: the row keeps its declared min-height only.">
              <Row style={{ "min-height": "32px", border: `1px dashed ${C.border}` }} />
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
