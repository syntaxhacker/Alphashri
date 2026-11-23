import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Center, Stack, Text, useMediaQuery } from "@/ui";
import { arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Center",
  tags: ["autodocs"],
  component: asStoryComponent(Center),
  parameters: {
    docs: {
      description: {
        component:
          "Center is a one-prop primitive: it renders flex + align-items:center + justify-content:center. inline switches the host to inline-flex so it sits inside a line of text rather than on its own block. Sizing and borders come from style/className — Center has no h/w/padding props of its own, so those are set through style.",
      },
    },
  },
  argTypes: {
    inline: arg.inline,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { inline: false },
  render: (args) =>
    solidStory(() => (
      <Center
        {...args}
        style={{ height: "160px", border: `1px solid ${C.primary}`, background: C.surface }}
      >
        <Tile label="centered" sub="both axes" w={180} h={64} tone={C.primary} />
      </Center>
    )),
};

export const BlockVsInline: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Block vs inline" caption="The default block Center occupies a full line; inline joins the surrounding text flow.">
          <Stack gap="md">
            <Demo label="inline={false}: the center takes the full width and centres its child on both axes.">
              <Center style={{ height: "96px", border: `1px solid ${C.border}`, background: C.surface }}>
                <Tile label="block center" w={160} h={40} />
              </Center>
            </Demo>
            <Demo label="inline: two inline centers sit on one text line; vertical centring is relative to the tallest line box.">
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Text size="sm" fs={MONO}>before</Text>
                <Center inline style={{ border: `1px solid ${C.info}`, padding: "4px", "vertical-align": "middle" }}>
                  <Text size="xs" fs={MONO}>inline A</Text>
                </Center>
                <Text size="sm" fs={MONO}>between</Text>
                <Center inline style={{ border: `1px solid ${C.info}`, padding: "4px", "vertical-align": "middle" }}>
                  <Text size="xs" fs={MONO}>inline B</Text>
                </Center>
                <Text size="sm" fs={MONO}>after</Text>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const FixedBoxes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Centering in fixed boxes" caption="Give Center an explicit height/width through style to see alignment along both axes.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0,1fr))", gap: "12px" }}>
            {([96, 160, 240] as const).map((h) => (
              <Center style={{ height: `${h}px`, border: `1px solid ${C.primary}`, background: C.surface }}>
                <Tile label={`${h}px tall`} w={120} h={40} tone={h === 160 ? C.info : C.border} />
              </Center>
            ))}
          </div>
        </Section>
      </Page>
    )),
};

export const ResponsiveCenter: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const height = createMemo(() => (isWide() ? 200 : 100));
      return (
        <Page>
          <Section title="Responsive centering" caption="The caller drives the host height from a media query; the child stays centred at both sizes.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Note>{`host height = ${height()}px`}</Note>
              <Center style={{ height: `${height()}px`, "margin-top": "8px", border: `1px dashed ${C.border}`, background: C.surface }}>
                <Tile label="always centred" w={160} h={44} tone={C.primary} />
              </Center>
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
        <Section title="Edge states" caption="Empty host, a child larger than the host, and multiple centred children.">
          <Stack gap="md">
            <Demo label="No children: the host still reserves its height.">
              <Center style={{ height: "48px", border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="Child wider than the host: caller-owned overflow:auto keeps the tail reachable.">
              <Center style={{ width: "240px", height: "80px", overflow: "auto", border: `1px solid ${C.info}` }}>
                <Tile label="wide child" w={420} h={40} />
              </Center>
            </Demo>
            <Demo label="Two children are centred as a group with a caller-supplied gap.">
              <Center style={{ height: "80px", border: `1px solid ${C.border}`, gap: "8px" }}>
                <Tile label="one" w={72} h={36} />
                <Tile label="two" w={72} h={36} tone={C.primary} />
              </Center>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
