import type { Meta, StoryObj } from "@storybook/html-vite";
import { createMemo } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Group, Stack, Text, useMediaQuery } from "@/ui";
import {
  arg, asStoryComponent, C, Demo, MONO, Note, Page, ResponsiveReadout, Section, Tile,
} from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Group",
  tags: ["autodocs"],
  component: asStoryComponent(Group),
  parameters: {
    docs: {
      description: {
        component:
          "Group is a flex row that defaults to flex-wrap:wrap and align-items:stretch. It is meant for groups of similar content; for controls prefer ToolbarRow, which forces align-items:center. grow and preventGrowOverflow are accepted for API compatibility but the primitive does not apply them — children need explicit flex/width to grow.",
      },
    },
  },
  argTypes: {
    direction: arg.direction,
    gap: arg.gap,
    spacing: arg.gap,
    justify: arg.justifyFlex,
    align: arg.alignFlex,
    wrap: arg.wrapFlex,
    grow: arg.bool,
    preventGrowOverflow: arg.bool,
    p: arg.padding,
    bg: arg.bg,
    w: arg.width,
  },
};
export default meta;
type Story = StoryObj;

const unequal = () => (
  <>
    <Tile label="tall 64" h={64} tone={C.primary} />
    <Button size="sm" variant="outline">short</Button>
    <Button size="sm">Action</Button>
  </>
);

export const Playground: Story = {
  args: {
    direction: "row",
    gap: "sm",
    align: "stretch",
    justify: "flex-start",
    wrap: "wrap",
  },
  render: (args) =>
    solidStory(() => (
      <Group {...args} style={{ border: `1px solid ${C.border}`, background: C.surface, padding: "8px" }}>
        {unequal()}
      </Group>
    )),
};

export const Alignment: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Alignment" caption="Default stretch makes the buttons fill the 64px row height; align='center' keeps their natural heights. This is why control rows use ToolbarRow.">
          <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "16px" }}>
            <Box p="md" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
              <Note>Group — default (stretch)</Note>
              <Group gap="sm" style={{ "margin-top": "8px", "min-height": "72px" }}>
                {unequal()}
              </Group>
            </Box>
            <Box p="md" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
              <Note>Group — align='center'</Note>
              <Group gap="sm" align="center" style={{ "margin-top": "8px", "min-height": "72px" }}>
                {unequal()}
              </Group>
            </Box>
          </div>
        </Section>
      </Page>
    )),
};

export const JustifyAndGap: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Justification & gap" caption="justify spreads the group across the available width; gap takes the same tokens as Flex (xs 4 · sm 8 · md 16 · lg 24 · xl 32).">
          <Stack gap="md">
            <Demo label="justify values on a full-width group.">
              <Stack gap="xs">
                {(["flex-start", "center", "flex-end", "space-between", "space-around"] as const).map((j) => (
                  <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{`justify='${j}'`}</Note>
                    <Group justify={j} gap="xs" style={{ "margin-top": "8px" }}>
                      <Tile label="A" w={56} h={28} tone={C.primary} />
                      <Tile label="B" w={56} h={28} tone={C.info} />
                      <Tile label="C" w={56} h={28} />
                    </Group>
                  </Box>
                ))}
              </Stack>
            </Demo>
            <Demo label="gap xs / md / xl over the same three tiles.">
              <Stack gap="xs">
                {(["xs", "md", "xl"] as const).map((g) => (
                  <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                    <Note>{`gap='${g}'`}</Note>
                    <Group gap={g} style={{ "margin-top": "8px" }}>
                      <Tile label="A" w={56} h={28} />
                      <Tile label="B" w={56} h={28} />
                      <Tile label="C" w={56} h={28} />
                    </Group>
                  </Box>
                ))}
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const WrapAndDirection: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Wrapping & direction" caption="Group wraps by default — five 120px tiles in a 420px host form two lines. wrap='nowrap' keeps one band and scrolls. direction='column' stacks them.">
          <Stack gap="md">
            <Demo label="wrap (default) in a 420px host.">
              <Box w={420} p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Group gap="xs">
                  {["A", "B", "C", "D", "E"].map((n) => <Tile label={n} w={120} h={36} tone={C.primary} />)}
                </Group>
              </Box>
            </Demo>
            <Demo label="wrap='nowrap': the host owns overflow:auto.">
              <Box w={420} style={{ overflow: "auto", border: `1px solid ${C.border}`, padding: "8px" }}>
                <Group gap="xs" wrap="nowrap">
                  {["A", "B", "C", "D", "E"].map((n) => <Tile label={n} w={120} h={36} tone={C.info} />)}
                </Group>
              </Box>
            </Demo>
            <Demo label="direction='column' with align='flex-start'.">
              <Group direction="column" gap="xs" align="flex-start" style={{ border: `1px dashed ${C.border}`, padding: "8px" }}>
                <Tile label="row 1" w={160} h={36} />
                <Tile label="row 2" w={160} h={36} />
              </Group>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const ResponsiveGroup: Story = {
  render: () =>
    solidStory(() => {
      const isWide = useMediaQuery("(min-width: 900px)");
      const direction = createMemo(() => (isWide() ? "row" : "column"));
      return (
        <Page>
          <Section title="Responsive wrap" caption="grouped badges reflow from a row to a column below 900px.">
            <Stack gap="xs">
              <ResponsiveReadout />
              <Group direction={direction()} gap="xs" style={{ "margin-top": "8px" }}>
                {["NIFTY 50", "BANKNIFTY", "5 min", "15 min", "1 hour"].map((label, i) => (
                  <Tile label={label} h={32} tone={i % 2 === 0 ? C.primary : C.info} />
                ))}
              </Group>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const CompatibilityAndEdges: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Compatibility & edge states" caption="grow / preventGrowOverflow are accepted but have no layout effect; growth is achieved with an explicit flex style on the child. Empty and single-child groups are also shown.">
          <Stack gap="md">
            <Demo label="grow={true} and preventGrowOverflow={true} are accepted — the children below keep their declared widths.">
              <Group gap="xs" grow preventGrowOverflow style={{ border: `1px dashed ${C.border}`, padding: "8px" }}>
                <Tile label="fixed 96" w={96} h={36} />
                <Tile label="fixed 96" w={96} h={36} />
              </Group>
            </Demo>
            <Demo label="Real growth: a child with flex='1' style absorbs the free space.">
              <Group gap="xs" style={{ border: `1px solid ${C.info}`, padding: "8px" }}>
                <Tile label="fixed" w={96} h={36} />
                <Box flex="1" p="xs" bg={C.alt} style={{ border: `1px solid ${C.primary}`, "min-width": "0" }}>
                  <Text size="xs" fs={MONO}>flex 1 child</Text>
                </Box>
              </Group>
            </Demo>
            <Demo label="Empty group and single child.">
              <Stack gap="xs">
                <Group h={36} style={{ border: `1px dashed ${C.border}` }} />
                <Group gap="xs" style={{ border: `1px solid ${C.border}`, padding: "8px" }}>
                  <Tile label="only child" h={36} />
                </Group>
              </Stack>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
