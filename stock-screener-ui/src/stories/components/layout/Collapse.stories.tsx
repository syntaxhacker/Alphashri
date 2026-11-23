import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Collapse, Stack, Text } from "@/ui";
import { arg, asStoryComponent, C, Demo, MONO, Note, Page, Section, Tile } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Collapse",
  tags: ["autodocs"],
  component: asStoryComponent(Collapse),
  parameters: {
    docs: {
      description: {
        component:
          "Collapse animates its child's height between 0 and auto using transitionDuration (default 225ms) and transitionTimingFunction (default ease). in is required and must be reactive to see the transition — a frozen boolean leaves the consumer at its mount-time state. unmountOnExit removes the subtree entirely when in=false; otherwise the node stays in the DOM with height:0 and aria-hidden=true. timeout is accepted but ignored.",
      },
    },
  },
  argTypes: {
    in: arg.in,
    transitionDuration: arg.duration,
    transitionTimingFunction: arg.timing,
    unmountOnExit: arg.bool,
    timeout: arg.legacy,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    in: true,
    transitionDuration: 225,
    transitionTimingFunction: "ease",
    unmountOnExit: false,
  },
  render: (args) =>
    solidStory(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <Stack gap="sm">
          <Box>
            <Button size="xs" variant="outline" onClick={() => setOpen((v) => !v)}>
              {open() ? "Collapse" : "Expand"}
            </Button>
          </Box>
          <Note>{`in=${open()} · duration=${args.transitionDuration ?? 225}ms`}</Note>
          <Collapse {...args} in={open()} style={{ border: `1px solid ${C.border}`, background: C.surface }}>
            <Box p="md">
              <Text size="sm" fs={MONO}>Collapsed content is present in the DOM.</Text>
              <Text size="xs" c={C.muted} fs={MONO}>height: auto when open, 0px when closed.</Text>
            </Box>
          </Collapse>
        </Stack>
      );
    }),
};

export const DurationScale: Story = {
  render: () =>
    solidStory(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <Page>
          <Section title="transitionDuration" caption="Duration is in ms and drives the height transition; timeout is ignored. Toggle once to compare the three speeds.">
            <Stack gap="md">
              <Box>
                <Button size="xs" onClick={() => setOpen((v) => !v)}>{open() ? "Collapse all" : "Expand all"}</Button>
              </Box>
              {([0, 150, 600] as const).map((d) => (
                <Demo label={`transitionDuration={${d}}`}>
                  <Collapse in={open()} transitionDuration={d} style={{ border: `1px solid ${C.info}` }}>
                    <Box p="sm"><Text size="xs" fs={MONO}>{`${d}ms height transition`}</Text></Box>
                  </Collapse>
                </Demo>
              ))}
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const TimingFunctions: Story = {
  render: () =>
    solidStory(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <Page>
          <Section title="transitionTimingFunction" caption="The timing string is passed through to the CSS transition. ease is the default.">
            <Stack gap="md">
              <Box>
                <Button size="xs" onClick={() => setOpen((v) => !v)}>{open() ? "Collapse all" : "Expand all"}</Button>
              </Box>
              {(["ease", "linear", "ease-in-out", "cubic-bezier(0.4, 0, 0.2, 1)"] as const).map((t) => (
                <Demo label={`transitionTimingFunction='${t}'`}>
                  <Collapse in={open()} transitionDuration={400} transitionTimingFunction={t} style={{ border: `1px solid ${C.border}` }}>
                    <Box p="sm"><Text size="xs" fs={MONO}>{t}</Text></Box>
                  </Collapse>
                </Demo>
              ))}
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const UnmountOnExit: Story = {
  render: () =>
    solidStory(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <Page>
          <Section title="unmountOnExit" caption="With unmountOnExit the subtree is removed when in=false; without it the node stays with height:0 and aria-hidden. The frames below keep a fixed height so the difference is visible.">
            <Stack gap="md">
              <Box>
                <Button size="xs" onClick={() => setOpen((v) => !v)}>{open() ? "Close both" : "Open both"}</Button>
              </Box>
              <div style={{ display: "grid", "grid-template-columns": "repeat(2, minmax(0,1fr))", gap: "12px" }}>
                <Box style={{ height: "112px", border: `1px dashed ${C.border}`, background: C.surface }}>
                  <Note>unmountOnExit={false} (default)</Note>
                  <Collapse in={open()} style={{ "margin-top": "8px" }}>
                    <Tile label="kept in DOM" h={48} tone={C.info} />
                  </Collapse>
                </Box>
                <Box style={{ height: "112px", border: `1px dashed ${C.border}`, background: C.surface }}>
                  <Note>unmountOnExit={true}</Note>
                  <Collapse in={open()} unmountOnExit style={{ "margin-top": "8px" }}>
                    <Tile label="removed from DOM" h={48} tone={C.primary} />
                  </Collapse>
                </Box>
              </div>
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
        <Section title="Edge states" caption="Empty children, closed-by-default content, and nested collapses.">
          <Stack gap="md">
            <Demo label="in={false} with no children: an empty 0px node with aria-hidden.">
              <Collapse in={false} style={{ border: `1px dashed ${C.border}` }} />
            </Demo>
            <Demo label="Closed by default: no fixed-height hole remains after the transition.">
              <Box>
                <Text size="xs" fs={MONO}>visible above</Text>
                <Collapse in={false}>
                  <Box p="md" bg={C.alt}><Text size="xs" fs={MONO}>hidden content</Text></Box>
                </Collapse>
                <Text size="xs" fs={MONO}>visible below (no gap)</Text>
              </Box>
            </Demo>
            <Demo label="Nested collapses: each owns its own height transition.">
              <Collapse in>
                <Box p="sm" style={{ border: `1px solid ${C.border}` }}>
                  <Text size="sm" fs={MONO}>outer</Text>
                  <Collapse in transitionDuration={150}>
                    <Box p="sm" style={{ "margin-top": "8px", border: `1px solid ${C.info}` }}>
                      <Text size="xs" fs={MONO}>inner, always open</Text>
                    </Box>
                  </Collapse>
                </Box>
              </Collapse>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
