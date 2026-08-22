import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text, Title } from "@mantine/core";
import { Tree } from "./Tree";
import { useTree } from "../hooks";
import type { UITreeNode } from "../types";

const meta: Meta<typeof Tree> = {
  title: "Primitives/Data Display/Tree",
  component: Tree,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tree>;

const data: UITreeNode[] = [
  {
    value: "strategies",
    label: "Strategies",
    children: [
      { value: "orb", label: "ORB Best" },
      { value: "sr", label: "SR Breakout" },
      {
        value: "week52",
        label: "52W Swing",
        children: [
          { value: "chaser", label: "Week52 Chaser" },
          { value: "target", label: "Week52 Target" },
        ],
      },
    ],
  },
  {
    value: "watchlist",
    label: "Watchlist",
    children: [
      { value: "reliance", label: "RELIANCE" },
      { value: "tcs", label: "TCS" },
    ],
  },
];

function InteractiveTree() {
  const tree = useTree({
    initialExpandedState: { strategies: true, week52: true },
  });
  return <Tree data={data} tree={tree} levelOffset={20} />;
}

export const Default: Story = {
  render: () => (
    <Stack gap="sm">
      <Title order={5}>Interactive tree</Title>
      <Text size="sm" c="dimmed">
        Click a folder to expand/collapse. "Strategies" and "52W Swing" start expanded.
      </Text>
      <InteractiveTree />
    </Stack>
  ),
};

export const Collapsed: Story = {
  render: () => {
    const tree = useTree();
    return (
      <Stack gap="sm">
        <Title order={5}>All collapsed</Title>
        <Tree data={data} tree={tree} levelOffset={20} />
      </Stack>
    );
  },
};
