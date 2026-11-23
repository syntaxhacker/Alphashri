import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Col, Row, ScrollArea, Stack, Text } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ROWS, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/ScrollArea",
  tags: ["autodocs"],
  component: asStoryComponent(ScrollArea),
  parameters: {
    docs: {
      description: {
        component:
          "ScrollArea is a div with overflow:auto and caller-supplied h/w (numbers become px). type/offsetScrollbars/scrollbarSize/scrollHideDelay are legacy Mantine-compat props: accepted but swallowed, so the native scrollbar is always used. onScrollPositionChange reports {x, y}. ScrollArea.Autosize is the same viewport without a fixed h/w. Do not wrap ECharts containers in ScrollArea.",
      },
    },
  },
  argTypes: {
    h: arg.height,
    w: arg.width,
    type: arg.legacy,
    offsetScrollbars: arg.legacy,
    scrollbarSize: arg.legacy,
    scrollHideDelay: arg.legacy,
    onScrollPositionChange: { control: false, description: "Called with { x, y } on scroll" },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    h: 168,
    type: "auto",
  },
  render: (args) =>
    solidStory(() => {
      const [pos, setPos] = createSignal({ x: 0, y: 0 });
      return (
        <Stack gap="xs">
          <Note>{`scroll position: x=${pos().x} · y=${pos().y}`}</Note>
          <ScrollArea {...args} onScrollPositionChange={setPos} style={{ border: `1px solid ${C.border}`, background: C.surface }}>
            <Stack gap="xs" p="xs">
              {ROWS.map((symbol) => <Tile label={symbol} sub="15m · watchlist" h={44} />)}
            </Stack>
          </ScrollArea>
        </Stack>
      );
    }),
};

export const VerticalAndHorizontal: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Both axes" caption="h constrains the vertical viewport; w constrains the horizontal one. Numbers are px.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
            <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
              <Note>ScrollArea h={'{168}'}</Note>
              <ScrollArea h={168} style={{ "margin-top": "8px", border: `1px dashed ${C.border}` }}>
                <Stack gap="xs" p="xs">
                  {ROWS.map((symbol) => <Tile label={symbol} h={40} />)}
                </Stack>
              </ScrollArea>
            </Box>
            <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
              <Note>ScrollArea w={'{320}'} + Row wrap={'{false}'}</Note>
              <ScrollArea w={320} style={{ "margin-top": "8px", border: `1px dashed ${C.border}` }}>
                <Row wrap={false} gap="xs">
                  {ROWS.map((symbol) => (
                    <Col><Tile label={symbol} w={140} h={40} tone={C.primary} /></Col>
                  ))}
                </Row>
              </ScrollArea>
            </Box>
          </div>
        </Section>
      </Page>
    )),
};

export const Autosize: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="ScrollArea.Autosize" caption="The Autosize variant owns no height: it fills whatever the caller's flex/grid parent gives it, then scrolls its overflow.">
          <Box style={{ display: "flex", "flex-direction": "column", height: "220px", border: `1px solid ${C.border}` }}>
            <Box p="sm" style={{ "border-bottom": `1px solid ${C.border}` }}>
              <Text size="sm" fw={700} fs={MONO}>Fixed header</Text>
            </Box>
            <ScrollArea.Autosize style={{ flex: "1", "min-height": "0" }}>
              <Stack gap="xs" p="sm">
                {ROWS.map((symbol) => <Tile label={symbol} h={40} />)}
              </Stack>
            </ScrollArea.Autosize>
          </Box>
        </Section>
      </Page>
    )),
};

export const LegacyTypeValues: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Legacy type props" caption="type/offsetScrollbars/scrollbarSize/scrollHideDelay are swallowed. Each value below produces the same native overflow:auto viewport; nothing is hidden or offset.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "8px" }}>
            {(["auto", "always", "scroll", "hover", "never"] as const).map((type) => (
              <Box>
                <Note>{`type='${type}'`}</Note>
                <ScrollArea type={type} h={96} style={{ "margin-top": "4px", border: `1px solid ${C.border}` }}>
                  <Stack gap="xs" p="xs">
                    {ROWS.slice(0, 6).map((symbol) => <Tile label={symbol} h={30} />)}
                  </Stack>
                </ScrollArea>
              </Box>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const EdgeStates: Story = {
  render: () =>
    solidStory(() => {
      const [last, setLast] = createSignal("no scroll yet");
      return (
        <Page>
          <Section title="Edge states" caption="Content shorter than the viewport, empty content, and a live scroll callback.">
            <Stack gap="md">
              <Demo label="Two rows in a 168px viewport: no scrollbar is needed, onScrollPositionChange stays at 0/0.">
                <ScrollArea h={168} onScrollPositionChange={(p) => setLast(`x=${p.x} y=${p.y}`)} style={{ border: `1px solid ${C.border}`, padding: "8px" }}>
                  <Stack gap="xs">
                    <Tile label="only row 1" h={40} />
                    <Tile label="only row 2" h={40} />
                  </Stack>
                </ScrollArea>
                <Note>{`last event: ${last()}`}</Note>
              </Demo>
              <Demo label="No children: the declared height is still reserved.">
                <ScrollArea h={64} style={{ border: `1px dashed ${C.border}` }} />
              </Demo>
              <Demo label="Raw CSS height/width strings also work (h='50vh' resolves as-is).">
                <ScrollArea h="96px" w="100%" style={{ border: `1px solid ${C.info}` }}>
                  <Box p="sm" style={{ width: "140%", "font-family": MONO, "font-size": "11px" }}>Wide content · scroll horizontally</Box>
                </ScrollArea>
              </Demo>
            </Stack>
          </Section>
        </Page>
      );
    }),
};
