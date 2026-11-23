import type { Meta, StoryObj } from "@storybook/html-vite";
import { Divider, List, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Section } from "./fixtures";

const sizeOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Typography/List",
  tags: ["autodocs"],
  component: List as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "List renders a <ul> by default or an <ol> with `type=\"ordered\"`. `withPadding` adds the 24px indent, `size` uses the shared type scale, and `listStyleType` / `center` pass through. Its companion `List.Item` (also exported as `ListItem`) accepts an `icon` slot.",
      },
    },
  },
  argTypes: {
    type: { control: { type: "inline-radio" }, options: ["unordered", "ordered"] },
    size: { control: { type: "select" }, options: sizeOptions },
    withPadding: { control: { type: "boolean" }, description: "Adds 24px left padding." },
    listStyleType: { control: { type: "text" }, description: "CSS list-style-type, e.g. disc / decimal / none." },
    center: { control: { type: "boolean" } },
    children: { control: false, description: "List.Item children." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { type: "unordered", size: "sm", withPadding: true, listStyleType: "disc" },
  render: (args) =>
    solidStory(() => (
      <List {...args}>
        <List.Item>Panels are separated by hairlines, not nested borders.</List.Item>
        <List.Item>Numbers use the mono stack and tabular figures.</List.Item>
        <List.Item>States are tone-coded, never hue-invented.</List.Item>
      </List>
    )),
};

export const OrderedAndUnordered: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Unordered" note="Default <ul>; withPadding adds the 24px indent and size uses the shared scale.">
          <List withPadding size="sm">
            <List.Item>Panels are separated by hairlines, not nested borders.</List.Item>
            <List.Item>Numbers use the mono stack and tabular figures.</List.Item>
            <List.Item>States are tone-coded, never hue-invented.</List.Item>
          </List>
          <Divider label="no padding" labelPosition="left" />
          <List size="sm" listStyleType="square">
            <List.Item>Square bullets from listStyleType.</List.Item>
            <List.Item>Zero left padding.</List.Item>
          </List>
        </Section>
        <Section title="Ordered" note="type='ordered' renders an <ol>; listStyleType picks the marker.">
          <List type="ordered" withPadding listStyleType="decimal" size="sm">
            <List.Item>Read the token from the source module.</List.Item>
            <List.Item>Render it with the local primitive.</List.Item>
            <List.Item>Verify it on a real surface.</List.Item>
          </List>
          <Divider label="roman numerals" labelPosition="left" />
          <List type="ordered" withPadding listStyleType="lower-roman" size="sm">
            <List.Item>First step</List.Item>
            <List.Item>Second step</List.Item>
          </List>
        </Section>
      </Stack>
    )),
};

export const IconsAndSizes: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "880px" }}>
        <Section title="Icons and alignment" note="List.Item takes an icon slot; center and listStyleType pass straight through to the list element.">
          <List size="sm" listStyleType="none" center>
            <List.Item icon={<Text size="xs" c="success" span>▲</Text>}>Positive flow</List.Item>
            <List.Item icon={<Text size="xs" c="error" span>▼</Text>}>Negative flow</List.Item>
            <List.Item icon={<Text size="xs" c="warning" span>◆</Text>}>Unconfirmed flow</List.Item>
          </List>
        </Section>
        <Section title="Sizes" note="The same list at each step of the shared type scale.">
          {sizeOptions.map((size) => (
            <List size={size} withPadding>
              <List.Item>{`size="${size}" — one line of list copy`}</List.Item>
            </List>
          ))}
        </Section>
      </Stack>
    )),
};
