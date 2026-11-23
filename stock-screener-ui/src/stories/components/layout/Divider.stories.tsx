import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Divider, Stack, Text } from "@/ui";
import { arg, asStoryComponent, C, Demo, MONO, Note, Page, Section } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Divider",
  tags: ["autodocs"],
  component: asStoryComponent(Divider),
  parameters: {
    docs: {
      description: {
        component:
          "Divider renders a themed hairline. Horizontal (default) is an <hr> with border-fin-border; vertical is a role=separator div with border-r and h-full. Only the vertical branch renders label ?? children — a horizontal Divider ignores label. color/size/labelPosition/flexItem are accepted for API compatibility but are not applied; aria-* attributes are forwarded to the DOM. Use className/style for any custom treatment.",
      },
    },
  },
  argTypes: {
    orientation: arg.orientation,
    label: { control: "text", description: "Rendered only on the vertical branch" },
    labelPosition: arg.labelPosition,
    color: arg.legacy,
    size: arg.legacy,
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: {
    orientation: "vertical",
    label: "section",
  },
  render: (args) =>
    solidStory(() => (
      <Box style={{ display: "flex", "align-items": "stretch", height: "72px", border: `1px solid ${C.border}`, padding: "12px", background: C.surface }}>
        <Text size="sm" fs={MONO}>left panel</Text>
        <Divider {...args} style={{ margin: "0 12px" }} />
        <Text size="sm" fs={MONO}>right panel</Text>
      </Box>
    )),
};

export const Orientations: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Orientation" caption="Horizontal is an <hr>; vertical is a full-height separator div.">
          <Stack gap="md">
            <Demo label="Horizontal rule between two text blocks.">
              <Box p="md" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Text size="sm" fs={MONO}>above the rule</Text>
                <Divider style={{ "margin-top": "12px", "margin-bottom": "12px" }} />
                <Text size="sm" fs={MONO}>below the rule</Text>
              </Box>
            </Demo>
            <Demo label="Vertical rule: h-full requires a parent with a resolved height.">
              <Box style={{ display: "flex", height: "72px", border: `1px solid ${C.border}`, background: C.surface }}>
                <Box p="sm" style={{ flex: "1" }}><Text size="sm" fs={MONO}>column A</Text></Box>
                <Divider orientation="vertical" />
                <Box p="sm" style={{ flex: "1" }}><Text size="sm" fs={MONO}>column B</Text></Box>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const LabelBehavior: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Labels" caption="The label is rendered only by the vertical branch. A horizontal Divider with a label looks identical to one without it — this is the real behaviour, not a missing demo value.">
          <Stack gap="md">
            <Demo label="vertical with label (and with children as fallback label).">
              <Stack gap="xs">
                <Box style={{ display: "flex", height: "48px", border: `1px solid ${C.border}`, background: C.surface }}>
                  <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>A</Text></Box>
                  <Divider orientation="vertical" label="label prop" style={{ margin: "0 8px" }} />
                  <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>B</Text></Box>
                </Box>
                <Box style={{ display: "flex", height: "48px", border: `1px solid ${C.border}`, background: C.surface }}>
                  <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>A</Text></Box>
                  <Divider orientation="vertical" style={{ margin: "0 8px" }}>child as label</Divider>
                  <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>B</Text></Box>
                </Box>
              </Stack>
            </Demo>
            <Demo label="horizontal label prop and labelPosition are swallowed — both rules below render the same <hr>.">
              <Box p="md" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Text size="xs" fs={MONO}>before</Text>
                <Divider label="ignored on horizontal" labelPosition="center" style={{ "margin-top": "8px", "margin-bottom": "8px" }} />
                <Text size="xs" fs={MONO}>after</Text>
              </Box>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};

export const CompatibilityProps: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Compatibility props" caption="color/size/flexItem/labelPosition are voided by the primitive. Custom colour is applied through style; custom thickness through style border-top-width.">
          <Stack gap="xs">
            {([["color='primary' + size=4", { color: "primary" as const, size: 4 }],
               ["style border-top", { style: { "border-top": `4px solid ${C.primary}` } }],
               ["className border-fin-border", { className: "border-t-4 border-fin-border" }]] as const).map(([label, props]) => (
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Note>{label}</Note>
                <Box style={{ "margin-top": "8px" }}><Divider {...props} /></Box>
              </Box>
            ))}
          </Stack>
        </Section>
      </Page>
    )),
};

export const AccessibilityAndEdges: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="A11y & edge states" caption="aria-* attributes are forwarded; ordinary unknown props are not. Empty vertical and horizontal dividers are shown.">
          <Stack gap="md">
            <Demo label="aria-label and aria-orientation survive the prop filter. Inspect the DOM.">
              <Divider aria-label="section break" aria-orientation="horizontal" />
            </Demo>
            <Demo label="Empty vertical separators still occupy their border width.">
              <Box style={{ display: "flex", height: "40px", border: `1px dashed ${C.border}`, background: C.surface }}>
                <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>left</Text></Box>
                <Divider orientation="vertical" />
                <Box p="sm" style={{ flex: "1" }}><Text size="xs" fs={MONO}>right</Text></Box>
              </Box>
            </Demo>
            <Demo label="Empty horizontal rule with no children.">
              <Divider />
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
