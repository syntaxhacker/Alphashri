import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, NumberInput, Select, Stack, Text, ToolbarRow, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section,
  TIMEFRAME_OPTIONS, UNIVERSE_OPTIONS,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/ToolbarRow",
  tags: ["autodocs"],
  component: asStoryComponent(ToolbarRow),
  parameters: {
    docs: {
      description: {
        component:
          "ToolbarRow is the enforced-alignment row for toolbars and filter clusters: align-items:center plus an explicit numeric gap (default 8px). justify accepts flex-start/center/flex-end/space-between. wrap defaults to true; wrap={false} keeps one band. clip={true} adds overflow:hidden. Inputs keep their natural height instead of being stretched by a taller sibling.",
      },
    },
  },
  argTypes: {
    gap: arg.gapNumber,
    justify: arg.justifyToolbar,
    wrap: arg.wrapBool,
    clip: arg.bool,
  },
};
export default meta;
type Story = StoryObj;

const controls = () => (
  <>
    <Select size="sm" w={168} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
    <Select size="sm" w={132} label="Timeframe" defaultValue="15m" data={TIMEFRAME_OPTIONS} />
    <NumberInput size="sm" w={104} label="Min score" defaultValue={80} min={0} max={100} hideControls />
  </>
);

export const Playground: Story = {
  args: {
    gap: 12,
    justify: "space-between",
    wrap: true,
    clip: false,
  },
  render: (args) =>
    solidStory(() => (
      <Box p="md" bg={C.surface} style={{ border: `1px solid ${C.border}`, "border-radius": "6px" }}>
        <ToolbarRow {...args}>
          <ToolbarRow gap={8}>
            {controls()}
          </ToolbarRow>
          <ToolbarRow gap={8} justify="flex-end">
            <Button size="sm" variant="outline">Reset</Button>
            <Button size="sm">Run screen</Button>
          </ToolbarRow>
        </ToolbarRow>
      </Box>
    )),
};

export const GapScale: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Gap" caption="gap is a number in px, not an 8pt token. The same three controls at 4 / 12 / 24px.">
          <Stack gap="md">
            {([4, 12, 24] as const).map((g) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`gap={${g}}`}</Note>
                <ToolbarRow gap={g} style={{ "margin-top": "8px" }}>
                  <Select size="xs" w={140} aria-label="Universe" defaultValue="nifty50" data={UNIVERSE_OPTIONS} />
                  <NumberInput size="xs" w={88} aria-label="Minimum score" defaultValue={75} hideControls />
                  <Button size="xs" variant="light">Apply</Button>
                </ToolbarRow>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const Justification: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Justification" caption="All four justify values, each with the same three controls.">
          <Stack gap="md">
            {(["flex-start", "center", "flex-end", "space-between"] as const).map((j) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{`justify='${j}'`}</Note>
                <ToolbarRow gap={8} justify={j} style={{ "margin-top": "8px" }}>
                  <Button size="xs" variant="subtle">Cancel</Button>
                  <Button size="xs">Apply</Button>
                  <Text size="xs" c={C.muted} fs={MONO}>three children</Text>
                </ToolbarRow>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const WrappingAndClip: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Wrapping & clip" caption="wrap defaults to true: four controls in 360px form two lines. wrap={false} keeps one band that scrolls; clip hides the overflow instead.">
          <Stack gap="md">
            <Demo label="wrap (default) in a 360px host.">
              <Box w={360} p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <ToolbarRow gap={8}>
                  <Select size="xs" w={140} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                  <NumberInput size="xs" w={92} label="Min score" defaultValue={80} hideControls />
                  <Button size="xs" variant="outline">Reset</Button>
                  <Button size="xs">Run</Button>
                </ToolbarRow>
              </Box>
            </Demo>
            <Demo label="wrap={false}: host scrolls horizontally to the tail.">
              <Box w={360} style={{ overflow: "auto", border: `1px solid ${C.border}`, padding: "8px" }}>
                <ToolbarRow gap={8} wrap={false}>
                  <Select size="xs" w={140} aria-label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
                  <Select size="xs" w={120} aria-label="Timeframe" defaultValue="15m" data={TIMEFRAME_OPTIONS} />
                  <NumberInput size="xs" w={88} aria-label="Minimum score" defaultValue={80} hideControls />
                  <Button size="xs" variant="outline">Reset</Button>
                  <Button size="xs">Run</Button>
                </ToolbarRow>
              </Box>
            </Demo>
            <Demo label="clip={true} on wrap={false}: overflow is hidden (use when the tail is intentionally unreachable).">
              <Box w={240} style={{ border: `1px dashed ${C.border}`, padding: "8px" }}>
                <ToolbarRow gap={8} wrap={false} clip>
                  <Button size="xs">One</Button>
                  <Button size="xs">Two</Button>
                  <Button size="xs">Three</Button>
                  <Button size="xs">Four</Button>
                </ToolbarRow>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveToolbar: Story = {
  render: () =>
    solidStory(() => {
      const isNarrow = useMediaQuery("(max-width: 720px)");
      const justify = createMemo(() => (isNarrow() ? "flex-start" : "space-between"));
      return (
        <Page>
          <Section title="Responsive toolbar" caption="Below 720px the control cluster stops spreading and wraps. Resize the canvas.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <ToolbarRow gap={8} justify={justify()} style={{ "margin-top": "8px", border: `1px solid ${C.border}`, padding: "8px" }}>
                {controls()}
                <Button size="sm">Run screen</Button>
              </ToolbarRow>
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
        <Section title="Edge states" caption="An empty row, a single tall control beside a short one, and a zero gap.">
          <Stack gap="md">
            <Demo label="No children: gap and padding still apply.">
              <ToolbarRow gap={8} style={{ "min-height": "36px", border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="A tall label beside a short button: align-items:center keeps both centred (compare Group's default stretch).">
              <ToolbarRow gap={8} style={{ border: `1px solid ${C.info}`, padding: "8px", "min-height": "64px" }}>
                <Text size="sm" fw={700} fs={MONO}>A very tall label</Text>
                <Button size="xs">Short</Button>
              </ToolbarRow>
            </Demo>
            <Demo label="gap={0}: controls sit flush.">
              <ToolbarRow gap={0} style={{ border: `1px solid ${C.border}`, padding: "8px" }}>
                <Button size="xs">A</Button>
                <Button size="xs">B</Button>
                <Button size="xs">C</Button>
              </ToolbarRow>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
