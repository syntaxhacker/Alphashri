import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo, For } from "solid-js";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Badge, Box, Button, Card, Center, Col, Collapse, Divider, Flex, Grid, GridCol,
  Group, NumberInput, Paper, Row, ScrollArea, Select, SimpleGrid as SimpleGridPrimitive,
  Stack, Text, ToolbarRow, useMediaQuery,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Layout",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Layout primitives in realistic desk compositions. Every cell is a real @/ui primitive; colour and spacing come from the running theme tokens, never a second palette.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

const MONO = palette.MONO;
const PRIMARY = "var(--color-fin-primary)";
const INFO = "var(--color-fin-info)";
const BORDER = "var(--color-fin-border)";
const MUTED = "var(--color-fin-text-muted)";
const ALT = "var(--color-fin-surface-alt)";

const Page = (props: { children: JSX.Element }) => (
  <Stack gap="xl" style={{ width: "100%", "max-width": "1120px" }}>
    {props.children}
  </Stack>
);

const Note = (props: { children: JSX.Element }) => (
  <Text size="xs" c={MUTED} fs={MONO} style={{ "line-height": "1.5" }}>
    {props.children}
  </Text>
);

const Section = (props: { title: string; caption?: string; children: JSX.Element }) => (
  <Box component="section" style={{ width: "100%" }}>
    <Stack gap="xs" style={{ "margin-bottom": "10px" }}>
      <Text size="xs" fw={700} tt="uppercase" c={PRIMARY} fs={MONO}>
        {props.title}
      </Text>
      {props.caption ? (
        <Text size="xs" c={MUTED} fs={MONO} style={{ "line-height": "1.5" }}>
          {props.caption}
        </Text>
      ) : null}
    </Stack>
    {props.children}
  </Box>
);

const Demo = (props: { label: string; children: JSX.Element }) => (
  <Stack gap="xs">
    <Note>{props.label}</Note>
    {props.children}
  </Stack>
);

const cell = (label: string, sub?: string, tone = BORDER) => (
  <Box
    p="sm"
    style={{
      display: "flex",
      "flex-direction": "column",
      "justify-content": "center",
      gap: "2px",
      height: "52px",
      "min-width": "0",
      overflow: "hidden",
      border: `1px solid ${tone}`,
      "border-radius": "4px",
      background: ALT,
    }}
  >
    <Text size="sm" fw={600} fs={MONO} truncate>{label}</Text>
    {sub ? <Text size="xs" c={MUTED} fs={MONO} truncate>{sub}</Text> : null}
  </Box>
);

const alignCell = (label: string, opts?: { height?: string; minHeight?: string }) => (
  <Box
    p="xs"
    style={{
      border: `1px solid ${PRIMARY}`,
      background: ALT,
      ...(opts?.height ? { height: opts.height } : {}),
      ...(opts?.minHeight ? { "min-height": opts.minHeight } : {}),
    }}
  >
    <Text size="xs" fs={MONO} style={{ "white-space": "nowrap" }}>{label}</Text>
  </Box>
);

const TwelveRuler = (props: { gap: number }) => (
  <Grid cols={12} gap={props.gap} style={{ "margin-bottom": "6px" }}>
    {Array.from({ length: 12 }, (_, i) => (
      <GridCol span={1}>
        <Box
          style={{
            height: "14px",
            display: "grid",
            "place-items": "center",
            border: `1px solid ${BORDER}`,
            background: ALT,
            color: MUTED,
            "font-family": MONO,
            "font-size": "9px",
          }}
        >
          {i + 1}
        </Box>
      </GridCol>
    ))}
  </Grid>
);

const UNIVERSE_OPTIONS = [
  { value: "nifty50", label: "NIFTY 50" },
  { value: "nifty500", label: "NIFTY 500" },
  { value: "banknifty", label: "BANKNIFTY" },
];
const TIMEFRAME_OPTIONS = [
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
];

const GRID_ITEMS = [
  { symbol: "RELIANCE", tf: "15m", pattern: "Ascending triangle", score: 94 },
  { symbol: "HDFCBANK", tf: "1h", pattern: "Flag retest", score: 88 },
  { symbol: "TCS", tf: "15m", pattern: "Double bottom", score: 91 },
  { symbol: "INFY", tf: "5m", pattern: "Range breakout", score: 79 },
  { symbol: "SBIN", tf: "1h", pattern: "Cup and handle", score: 86 },
  { symbol: "MARUTI", tf: "15m", pattern: "Head and shoulders", score: 73 },
];

/** Mirrors PatternGrid / PatternImageManager: breakpoints pick a live column count. */
const ResponsiveCardGrid = () => {
  const isWide = useMediaQuery("(min-width: 1400px)");
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isTablet = useMediaQuery("(min-width: 900px)");
  const cols = createMemo(() => (isWide() ? 4 : isDesktop() ? 3 : isTablet() ? 2 : 1));

  return (
    <Stack gap="xs">
      <Note>
        {`1400px → 4 · 1200px → 3 · 900px → 2 · below → 1  (active cols = ${cols()})`}
      </Note>
      <SimpleGridPrimitive cols={cols()} spacing={8} verticalSpacing={16}>
        <For each={GRID_ITEMS}>
          {(item) => (
            <Card p="sm" radius="sm" className="border border-fin-border">
              <Stack gap="xs">
                <Flex justify="space-between" align="center">
                  <Text size="sm" fw={700} fs={MONO} truncate>{item.symbol}</Text>
                  <Badge size="xs" color={item.score >= 90 ? "success" : "info"}>
                    {item.score}
                  </Badge>
                </Flex>
                <Text size="xs" c={MUTED} fs={MONO} truncate>
                  {`${item.tf} · ${item.pattern}`}
                </Text>
              </Stack>
            </Card>
          )}
        </For>
      </SimpleGridPrimitive>
    </Stack>
  );
};

const ViewportReadout = () => {
  const sm = useMediaQuery("(min-width: 640px)");
  const md = useMediaQuery("(min-width: 768px)");
  const lg = useMediaQuery("(min-width: 1024px)");
  return (
    <Note>
      {`active breakpoint: ${lg() ? "lg (≥1024)" : md() ? "md (≥768)" : sm() ? "sm (≥640)" : "base (<640)"}`}
    </Note>
  );
};

const unequalChildren = () => (
  <>
    <Box p="sm" style={{ height: "64px", border: `1px solid ${PRIMARY}`, background: ALT, "border-radius": "4px" }}>
      <Text size="xs" fs={MONO}>tall 64px</Text>
    </Box>
    <Badge size="sm" color="info">short</Badge>
    <Button size="sm" variant="outline">Action</Button>
  </>
);

export const GridMatrix: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="GridMatrix"
          caption="Grid renders repeat(cols, minmax(0,1fr)); GridCol span writes a real grid-column. The numbered ruler marks all 12 tracks so the spans can be checked by eye."
        >
          <Stack gap="lg">
            <Demo label="span 4 / span 8 on the same 12 tracks and the same numeric gap (8px) as the ruler: 4/12 ≈ one third, 8/12 ≈ two thirds.">
              <TwelveRuler gap={8} />
              <Grid cols={12} gap={8}>
                <GridCol span={4}>{cell("span 4", "grid-column: span 4 / span 4 · ≈1/3", PRIMARY)}</GridCol>
                <GridCol span={8}>{cell("span 8", "grid-column: span 8 / span 8 · ≈2/3", INFO)}</GridCol>
              </Grid>
            </Demo>

            <Demo label="offset n sets grid-column-start = n+1. Three 4-wide cells pinned to tracks 1–4, 5–8 and 9–12.">
              <TwelveRuler gap={8} />
              <Grid cols={12} gap={8}>
                <GridCol span={4} offset={0}>{cell("offset 0", "cols 1–4")}</GridCol>
                <GridCol span={4} offset={4}>{cell("offset 4", "cols 5–8", PRIMARY)}</GridCol>
                <GridCol span={4} offset={8}>{cell("offset 8", "cols 9–12")}</GridCol>
              </Grid>
            </Demo>

            <Demo label="order reorders visually without touching DOM order: DOM A/B/C renders as B (1), C (2), A (3).">
              <Grid cols={12} gap={8}>
                <GridCol span={4} order={3}>{cell("DOM A · order 3", "renders last")}</GridCol>
                <GridCol span={4} order={1}>{cell("DOM B · order 1", "renders first", PRIMARY)}</GridCol>
                <GridCol span={4} order={2}>{cell("DOM C · order 2", "renders second")}</GridCol>
              </Grid>
            </Demo>

            <Demo label="span='auto' and span='content' leave grid-column unset, so the cell auto-places into the next free single track; a numeric span is explicit.">
              <Grid cols={12} gap={8}>
                <GridCol span="auto">{cell("span auto", "auto-placed")}</GridCol>
                <GridCol span="content">{cell("span content", "auto-placed")}</GridCol>
                <GridCol span={6}>{cell("span 6", "explicit 6/12", INFO)}</GridCol>
              </Grid>
            </Demo>

            <Demo label="rows={2} + flow='col' → a 4×2 track matrix filled top-to-bottom, column by column (1·2 in col 1, 3·4 in col 2, …).">
              <Grid cols={4} rows={2} flow="col" gap={8}>
                {Array.from({ length: 8 }, (_, i) => (
                  <GridCol span={1}>{cell(String(i + 1), undefined, i % 2 === 0 ? PRIMARY : BORDER)}</GridCol>
                ))}
              </Grid>
            </Demo>

            <Demo label="numeric gap is px: the same two half-width cells at gap={4} and gap={20}.">
              <Stack gap="xs">
                <Grid cols={12} gap={4}>
                  <GridCol span={6}>{cell("gap 4px · span 6")}</GridCol>
                  <GridCol span={6}>{cell("gap 4px · span 6")}</GridCol>
                </Grid>
                <Grid cols={12} gap={20}>
                  <GridCol span={6}>{cell("gap 20px · span 6")}</GridCol>
                  <GridCol span={6}>{cell("gap 20px · span 6")}</GridCol>
                </Grid>
              </Stack>
            </Demo>

            <Demo label="a nested Grid defines its own 2-track context inside the outer 8-track cell.">
              <Grid cols={12} gap={8}>
                <GridCol span={8}>
                  <Box p="xs" style={{ border: `1px solid ${PRIMARY}`, "border-radius": "4px", background: "var(--color-fin-surface)" }}>
                    <Note>outer cell · span 8</Note>
                    <Grid cols={2} gap={8} style={{ "margin-top": "6px" }}>
                      <GridCol span={1}>{cell("nested 1/2")}</GridCol>
                      <GridCol span={1}>{cell("nested 2/2")}</GridCol>
                    </Grid>
                  </Box>
                </GridCol>
                <GridCol span={4}>{cell("outer span 4", "sibling cell", INFO)}</GridCol>
              </Grid>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const RowMatrix: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="RowMatrix"
          caption="Row is a 12-track grid by default; wrap={false} switches it to a max-content band. Col uses base spans with sm/md/lg overrides and per-item order/align."
        >
          <Stack gap="lg">
            <Demo label="cols={6} divides the row into 6 tracks — span 3 fills half. The default is cols=12.">
              <Row cols={6} gap={8}>
                <Col span={3}>{cell("span 3 of 6")}</Col>
                <Col span={3}>{cell("span 3 of 6")}</Col>
              </Row>
            </Demo>

            <Demo label="all justify values on wrap={false} rows — a max-content band leaves free space, so justify-content is visible (it has no effect on a full-width 12-track grid).">
              <SimpleGridPrimitive cols={2} spacing={16} verticalSpacing={16}>
                {(["start", "center", "end", "between", "around", "evenly"] as const).map((j) => (
                  <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                    <Note>{`justify="${j}" · wrap={false}`}</Note>
                    <Row wrap={false} gap={8} justify={j} style={{ "margin-top": "8px" }}>
                      {["A", "B", "C"].map((n) => (
                        <Col>
                          <Box
                            style={{
                              width: "56px", height: "28px", display: "grid", "place-items": "center",
                              border: `1px solid ${PRIMARY}`, background: ALT,
                              "font-family": MONO, "font-size": "11px",
                            }}
                          >
                            {n}
                          </Box>
                        </Col>
                      ))}
                    </Row>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="all align values over deliberately unequal children (28 / 56 / 40px). stretch drops the fixed heights and stretches to the tallest cell; baseline aligns the text baselines.">
              <SimpleGridPrimitive cols={2} spacing={16} verticalSpacing={16}>
                {(["start", "center", "end", "stretch", "baseline"] as const).map((a) => (
                  <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                    <Note>{`align="${a}"`}</Note>
                    <Row cols={12} gap={8} align={a} style={{ "margin-top": "8px", "min-height": "72px" }}>
                      <Col span={3}>{alignCell("short", a === "stretch" ? {} : { height: "28px" })}</Col>
                      <Col span={3}>
                        {alignCell("tall", a === "stretch" ? { minHeight: "56px" } : { height: "56px" })}
                      </Col>
                      <Col span={3}>{alignCell("mid", a === "stretch" ? {} : { height: "40px" })}</Col>
                    </Row>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="Col base span plus responsive spans: 12 → 6 → 4 → 3 across the sm/md/lg breakpoints. Resize the canvas to see them change.">
              <ViewportReadout />
              <Row cols={12} gap={8} style={{ "margin-top": "8px" }}>
                {["A", "B", "C", "D"].map((n) => (
                  <Col span={12} sm={6} md={4} lg={3}>{cell(n, "12 → 6 → 4 → 3")}</Col>
                ))}
              </Row>
            </Demo>

            <Demo label="order + align on Col: DOM A/B/C renders visually as C (order 1), A (order 2), B (order 3), each aligned independently inside an 88px row.">
              <Row cols={12} gap={8} align="start" style={{ "min-height": "88px" }}>
                <Col span={4} order={2} align="start">{alignCell("DOM A · order 2 · align start", { height: "28px" })}</Col>
                <Col span={4} order={3} align="end">{alignCell("DOM B · order 3 · align end", { height: "28px" })}</Col>
                <Col span={4} order={1} align="center">{alignCell("DOM C · order 1 · align center", { height: "28px" })}</Col>
              </Row>
            </Demo>

            <Demo label="wrap={false} overflow: four 160px Cols in a 420px host form one max-content band — scroll horizontally to reach the tail.">
              <Box w={420} style={{ overflow: "auto", border: `1px solid ${BORDER}`, "border-radius": "4px", padding: "8px" }}>
                <Row wrap={false} gap={8}>
                  {[1, 2, 3, 4].map((n) => (
                    <Col><Box w={160}>{cell(`item ${n}`, "160px")}</Box></Col>
                  ))}
                </Row>
              </Box>
            </Demo>

            <Demo label="wrap=true (default): three span-6 Cols need 18 of 12 tracks, so the third cell drops to an implicit second row.">
              <Row cols={12} gap={8}>
                <Col span={6}>{cell("1 · span 6")}</Col>
                <Col span={6}>{cell("2 · span 6")}</Col>
                <Col span={6}>{cell("3 · span 6 → wrapped", undefined, PRIMARY)}</Col>
              </Row>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const SimpleGrid: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="SimpleGrid"
          caption="Equal columns with numeric gaps. The responsive card grid uses the same useMediaQuery + createMemo pattern as PatternGrid / PatternImageManager."
        >
          <Stack gap="lg">
            <Demo label="numeric spacing={8} sets an 8px gap; verticalSpacing={24} overrides only row-gap, so columns stay tight and rows breathe.">
              <SimpleGridPrimitive cols={3} spacing={8} verticalSpacing={24}>
                {Array.from({ length: 6 }, (_, i) => cell(`card ${i + 1}`, "gap-x 8 · gap-y 24"))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="default fallback: no cols prop means 1 column, so the cards stack. No spacing prop means no gap.">
              <SimpleGridPrimitive>
                {cell("stacked 1")}
                {cell("stacked 2")}
                {cell("stacked 3")}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="responsive columns, live from the canvas width — resize Storybook at 900 / 1200 / 1400px.">
              <ResponsiveCardGrid />
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ControlRows: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="ControlRows"
          caption="ToolbarRow is the control-row contract: align-items:center plus an explicit px gap, so a tall label or button never stretches or drifts away from its siblings."
        >
          <Stack gap="lg">
            <Demo label="real Select / NumberInput / Button in a ToolbarRow — gap={12}, justify='space-between', wrap={false}. Every input has an explicit w so it never goes full-width.">
              <Paper p="md" radius="sm" shadow="xs" className="border border-fin-border">
                <ToolbarRow gap={12} justify="space-between" wrap={false}>
                  <ToolbarRow gap={8}>
                    <Select size="sm" w={168} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                    <Select size="sm" w={132} label="Timeframe" defaultValue="15m" data={TIMEFRAME_OPTIONS} />
                    <NumberInput size="sm" w={104} label="Min score" defaultValue={80} min={0} max={100} hideControls />
                  </ToolbarRow>
                  <ToolbarRow gap={8}>
                    <Button size="sm" variant="outline">Reset</Button>
                    <Button size="sm">Run screen</Button>
                  </ToolbarRow>
                </ToolbarRow>
              </Paper>
            </Demo>

            <Demo label="gap is a number in px and justify maps to flex justification: gap = 4 / 16 / 24, then a right-aligned action cluster.">
              <Stack gap="xs">
                {([4, 16, 24] as const).map((g) => (
                  <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                    <Note>{`gap = ${g}px`}</Note>
                    <ToolbarRow gap={g} style={{ "margin-top": "8px" }}>
                      <Select size="xs" w={120} aria-label="Universe" defaultValue="nifty50" data={UNIVERSE_OPTIONS} />
                      <NumberInput size="xs" w={88} aria-label="Minimum score" defaultValue={75} hideControls />
                      <Button size="xs" variant="light">Apply</Button>
                    </ToolbarRow>
                  </Box>
                ))}
                <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>justify='flex-end'</Note>
                  <ToolbarRow gap={8} justify="flex-end" style={{ "margin-top": "8px" }}>
                    <Button size="xs" variant="subtle">Cancel</Button>
                    <Button size="xs">Apply</Button>
                  </ToolbarRow>
                </Box>
              </Stack>
            </Demo>

            <Demo label="wrap={false} in a 360px host keeps the band on one line; the controls scroll horizontally instead of stacking.">
              <Box w={360} style={{ overflow: "auto", border: `1px solid ${BORDER}`, "border-radius": "4px", padding: "8px" }}>
                <ToolbarRow gap={8} wrap={false}>
                  <Select size="xs" w={140} aria-label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                  <Select size="xs" w={120} aria-label="Timeframe" defaultValue="15m" data={TIMEFRAME_OPTIONS} />
                  <NumberInput size="xs" w={88} aria-label="Minimum score" defaultValue={80} hideControls />
                  <Button size="xs" variant="outline">Reset</Button>
                  <Button size="xs">Run</Button>
                </ToolbarRow>
              </Box>
            </Demo>

            <Demo label="Group defaults to align-items:stretch, so deliberately unequal children fill the row height. align='center' keeps their natural heights — for controls, prefer ToolbarRow.">
              <SimpleGridPrimitive cols={2} spacing={16}>
                <Box p="md" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Group (default stretch)</Note>
                  <Group gap="sm" style={{ "margin-top": "8px" }}>{unequalChildren()}</Group>
                </Box>
                <Box p="md" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Group align='center'</Note>
                  <Group gap="sm" align="center" style={{ "margin-top": "8px" }}>{unequalChildren()}</Group>
                </Box>
              </SimpleGridPrimitive>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const BoxAndFlex: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="BoxAndFlex"
          caption="Box is the generic primitive (semantic tag, sizing, spacing, position); Flex, Stack and Group are flex layouts with different defaults."
        >
          <Stack gap="lg">
            <Demo label="Box component='aside', w=260 h=96, p='md' (the 16px token), pos='relative' with an absolutely positioned corner tag at top/right 8px.">
              <Box
                component="aside"
                p="md"
                w={260}
                h={96}
                pos="relative"
                bg={ALT}
                style={{ border: `1px solid ${PRIMARY}`, "border-radius": "4px" }}
              >
                <Text size="sm" fw={600} fs={MONO}>Box · aside</Text>
                <Text size="xs" c={MUTED} fs={MONO}>260 × 96 · padding 16</Text>
                <Box
                  pos="absolute"
                  top={8}
                  right={8}
                  px="xs"
                  py="xs"
                  bg="var(--color-fin-primary)"
                  c="var(--color-fin-bg)"
                  style={{ "font-family": MONO, "font-size": "9px", "border-radius": "2px" }}
                >
                  abs 8/8
                </Box>
              </Box>
            </Demo>

            <Demo label="Flex direction — row, row-reverse and column over the same three children.">
              <SimpleGridPrimitive cols={3} spacing={16}>
                {(["row", "row-reverse", "column"] as const).map((d) => (
                  <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                    <Note>{`direction="${d}"`}</Note>
                    <Flex direction={d} gap="xs" style={{ "margin-top": "8px" }}>
                      {["1", "2", "3"].map((n) => (
                        <Box
                          p="xs"
                          style={{
                            border: `1px solid ${PRIMARY}`, background: ALT,
                            "font-family": MONO, "font-size": "11px", "text-align": "center",
                          }}
                        >
                          {n}
                        </Box>
                      ))}
                    </Flex>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="Flex wrap='wrap' — five 120px cells in a 420px band wrap to two lines.">
              <Box w={420} p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                <Flex wrap="wrap" gap="sm">
                  {["A", "B", "C", "D", "E"].map((n) => (
                    <Box
                      w={120}
                      p="xs"
                      style={{
                        border: `1px solid ${PRIMARY}`, background: ALT,
                        "font-family": MONO, "font-size": "11px", "text-align": "center",
                      }}
                    >
                      {n}
                    </Box>
                  ))}
                </Flex>
              </Box>
            </Demo>

            <Demo label="Stack is a column flex by default; direction='row' makes a horizontal stack.">
              <SimpleGridPrimitive cols={2} spacing={16}>
                <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Stack (column) gap=8</Note>
                  <Stack gap="xs" style={{ "margin-top": "8px" }}>
                    {cell("row 1")}
                    {cell("row 2")}
                  </Stack>
                </Box>
                <Box p="sm" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Stack direction='row'</Note>
                  <Stack direction="row" gap="xs" style={{ "margin-top": "8px" }}>
                    {cell("col 1")}
                    {cell("col 2")}
                  </Stack>
                </Box>
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="Group stretch vs center with unequal children (the same trio appears in both panels).">
              <SimpleGridPrimitive cols={2} spacing={16}>
                <Box p="md" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Group — default stretch</Note>
                  <Group gap="sm" style={{ "margin-top": "8px" }}>{unequalChildren()}</Group>
                </Box>
                <Box p="md" style={{ border: `1px solid ${BORDER}`, "border-radius": "4px" }}>
                  <Note>Group — align='center'</Note>
                  <Group gap="sm" align="center" style={{ "margin-top": "8px" }}>{unequalChildren()}</Group>
                </Box>
              </SimpleGridPrimitive>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

const PAPER_RADII = [["xs", "2px"], ["sm", "4px"], ["md", "6px"], ["lg", "10px"], ["xl", "14px"]] as const;
const CARD_RADII = [["xs", "4px"], ["sm", "8px"], ["md", "16px"], ["lg", "24px"], ["xl", "32px"]] as const;

export const Surfaces: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="Surfaces"
          caption="Paper and Card share the surface ramp but not the radius scale: Paper follows the control-friendly 2/4/6/10/14 ramp, Card is a full step larger at every name. The px figures are documented values mirroring the scales hardcoded inside Paper.tsx / Card.tsx — they are not exported tokens."
        >
          <Stack gap="lg">
            <Demo label="Paper radius scale — xs 2 · sm 4 · md 6 · lg 10 · xl 14. shadow='xs' and component='div' keep the comparison neutral.">
              <SimpleGridPrimitive cols={5} spacing={8}>
                {PAPER_RADII.map(([name, px]) => (
                  <Box>
                    <Paper
                      p="sm" radius={name} shadow="xs" component="div"
                      className="border border-fin-border"
                      style={{ height: "56px", display: "grid", "place-items": "center" }}
                    >
                      <Text size="sm" fw={700} fs={MONO}>{name}</Text>
                    </Paper>
                    <Note>{px}</Note>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="Card radius scale — xs 4 · sm 8 · md 16 · lg 24 · xl 32. Card uses padding rather than p for its content inset.">
              <SimpleGridPrimitive cols={5} spacing={8}>
                {CARD_RADII.map(([name, px]) => (
                  <Box>
                    <Card padding="sm" radius={name} className="border border-fin-border h-14 grid place-items-center">
                      <Text size="sm" fw={700} fs={MONO}>{name}</Text>
                    </Card>
                    <Note>{px}</Note>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="same radius name, different result: Paper md = 6px (a control corner) vs Card md = 16px (a panel corner).">
              <SimpleGridPrimitive cols={2} spacing={16}>
                <Box>
                  <Note>Paper radius='md' → 6px</Note>
                  <Paper p="md" radius="md" className="border border-fin-border" style={{ height: "64px", display: "grid", "place-items": "center" }}>
                    <Text size="sm" fs={MONO}>Paper</Text>
                  </Paper>
                </Box>
                <Box>
                  <Note>Card radius='md' → 16px</Note>
                  <Card padding="md" radius="md" className="border border-fin-border h-16 grid place-items-center">
                    <Text size="sm" fs={MONO}>Card</Text>
                  </Card>
                </Box>
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="named Paper shadows reuse Tailwind shadow-* utilities; component='article' keeps the markup semantic.">
              <SimpleGridPrimitive cols={5} spacing={8}>
                {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => (
                  <Paper
                    p="sm" radius="sm" shadow={s} component="article"
                    className="border border-fin-border"
                    style={{ height: "56px", display: "grid", "place-items": "center" }}
                  >
                    <Text size="xs" fs={MONO}>{`shadow ${s}`}</Text>
                  </Paper>
                ))}
              </SimpleGridPrimitive>
            </Demo>

            <Demo label="an unnamed shadow is caller-owned raw CSS — here palette.DIALOG_SHADOW, the app's single dialog shadow.">
              <Paper p="md" radius="sm" shadow={palette.DIALOG_SHADOW} className="border border-fin-border" style={{ "max-width": "420px" }}>
                <Text size="sm" fs={MONO}>shadow = palette.DIALOG_SHADOW</Text>
                <Note>0 8px 32px rgba(0,0,0,0.5)</Note>
              </Paper>
            </Demo>

            <Demo label="Card padding follows the 8pt sp() ramp (xs 4 · sm 8 · md 16 · lg 24 · xl 32).">
              <SimpleGridPrimitive cols={5} spacing={8}>
                {(["xs", "sm", "md", "lg", "xl"] as const).map((sz) => (
                  <Box>
                    <Card padding={sz} radius="sm" component="article" className="border border-fin-border">
                      <Box bg={ALT} p="xs" style={{ "font-family": MONO, "font-size": "10px" }}>content</Box>
                    </Card>
                    <Note>{`padding='${sz}'`}</Note>
                  </Box>
                ))}
              </SimpleGridPrimitive>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const Responsive390: Story = {
  // Storybook 10 reads story-level globals for the viewport; `defaultViewport`
  // is kept alongside it as the declarative pin requested by the story contract.
  globals: { viewport: "mobile1" },
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
      // The built-in mobile1 preset is 320px; the handset fixture here is 390px,
      // so useMediaQuery resolves the same base branch a 390px device sees.
      options: {
        mobile1: {
          name: "Handset 390",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
      },
    },
  },
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="Responsive390"
          caption="Pinned to a 390px viewport — the handset width. matchMedia / useMediaQuery resolve against the iframe width, so the readout below reads base (<640) and the 12 → 6 → 4 → 3 Col branches stay stacked here."
        >
          <Box w={390} p="md" bg="var(--color-fin-surface)" style={{ border: `1px solid ${BORDER}`, "border-radius": "6px", "max-width": "100%" }}>
            <Stack gap="lg">
              <Demo label="base spans are viewport-independent: 6/6 and 4/4/4 inside 390px.">
                <Stack gap="xs">
                  <Row cols={12} gap={8}>
                    <Col span={6}>{cell("span 6")}</Col>
                    <Col span={6}>{cell("span 6")}</Col>
                  </Row>
                  <Row cols={12} gap={8}>
                    {[4, 4, 4].map((n, i) => <Col span={n}>{cell(`span ${n} · ${i + 1}`)}</Col>)}
                  </Row>
                </Stack>
              </Demo>

              <Demo label="Col base=12 → sm=6 → md=4 → lg=3: four cards stack below 640px and fan out as the canvas widens.">
                <ViewportReadout />
                <Row cols={12} gap={8} style={{ "margin-top": "8px" }}>
                  {["A", "B", "C", "D"].map((n) => (
                    <Col span={12} sm={6} md={4} lg={3}>{cell(n, "12 → 6 → 4 → 3")}</Col>
                  ))}
                </Row>
              </Demo>

              <Demo label="ToolbarRow wraps by default: four real controls in 390px form two lines.">
                <ToolbarRow gap={8}>
                  <Select size="xs" w={140} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                  <NumberInput size="xs" w={92} label="Min score" defaultValue={80} hideControls />
                  <Button size="xs" variant="outline">Reset</Button>
                  <Button size="xs">Run</Button>
                </ToolbarRow>
              </Demo>

              <Demo label="wrap={false} keeps one band; the same controls scroll horizontally instead.">
                <Box w="100%" style={{ overflow: "auto", border: `1px solid ${BORDER}`, "border-radius": "4px", padding: "8px" }}>
                  <ToolbarRow gap={8} wrap={false}>
                    <Select size="xs" w={140} aria-label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                    <NumberInput size="xs" w={92} aria-label="Minimum score" defaultValue={80} hideControls />
                    <Button size="xs" variant="outline">Reset</Button>
                    <Button size="xs">Run</Button>
                  </ToolbarRow>
                </Box>
              </Demo>

              <Demo label="responsive SimpleGrid mirrors PatternGrid: 4/3/2/1 columns from the canvas width.">
                <ResponsiveCardGrid />
              </Demo>
            </Stack>
          </Box>
        </Section>
      </Page>
    )),
};

export const ScrollAndCollapse: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section
          title="ScrollAndCollapse"
          caption="ScrollArea owns its own scroll viewport; Collapse animates content without leaving a fixed-height hole."
        >
          <SimpleGridPrimitive cols={2} spacing={16}>
            <Box p="md" className="border border-fin-border">
              <Note>ScrollArea h=168 type='auto'</Note>
              <ScrollArea h={168} type="auto" style={{ "margin-top": "8px" }}>
                <Stack gap="xs">
                  {Array.from({ length: 10 }, (_, i) => cell(`Scan row ${i + 1}`))}
                </Stack>
              </ScrollArea>
            </Box>
            <Box p="md" className="border border-fin-border">
              <Note>Collapse in + Center + Divider</Note>
              <Collapse in>
                <Box style={{ "margin-top": "8px" }}>
                  <Card padding="sm" radius="sm" className="border border-fin-border">
                    <Text size="sm" fs={MONO}>Collapsed content is visible.</Text>
                  </Card>
                </Box>
              </Collapse>
              <Center h={80} style={{ "margin-top": "8px", border: `1px dashed ${BORDER}` }}>
                <Text size="xs" c={MUTED} fs={MONO}>Center</Text>
              </Center>
              <Divider label="section" labelPosition="center" />
            </Box>
          </SimpleGridPrimitive>
        </Section>
      </Page>
    )),
};
