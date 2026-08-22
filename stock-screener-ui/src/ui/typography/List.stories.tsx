import type { Meta, StoryObj } from "@storybook/react-vite";
import { List } from "./List";

const meta: Meta<typeof List> = {
  title: "Design System/Typography/List",
  component: List,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof List>;

const items = (
  <>
    <List.Item>First item</List.Item>
    <List.Item>Second item</List.Item>
    <List.Item>Third item</List.Item>
  </>
);

export const Unordered: Story = {
  render: () => <List type="unordered" withPadding spacing="sm">{items}</List>,
};

export const Ordered: Story = {
  render: () => <List type="ordered" withPadding spacing="sm">{items}</List>,
};

export const WithIcon: Story = {
  args: {
    type: "unordered",
    withPadding: true,
    icon: <span aria-hidden>✓</span>,
    children: items,
  },
};

// App usage: size="sm" lists in news articles / guides (ArticleDetail, OptionChainGuide)
export const SmallWithPadding: Story = {
  render: () => (
    <List size="sm" withPadding spacing="sm">
      <List.Item>Key point from article summary</List.Item>
      <List.Item>Second analysis point</List.Item>
      <List.Item>Third takeaway</List.Item>
    </List>
  ),
};
