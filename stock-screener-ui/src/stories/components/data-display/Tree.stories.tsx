import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Badge, Box, Group, Stack, Text, Tree, type UITreeNode } from "@/ui";
import { Page, Readout, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Data display/Tree",
  tags: ["autodocs"],
  component: Tree as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Tree renders nested UITreeNode[] data. `expanded` is a list of expanded node values (controlled with `onExpandedChange`, otherwise internal), `onNodeClick` fires for every clicked node and `levelOffset` sets the per-level indent. `renderNode` replaces the label with custom JSX while the component still owns chevrons, indentation and expansion. There are no `selected` or `disabled` props: the Selection and DisabledNodes stories compose both through `renderNode`, `onNodeClick` and a controlled `expanded` list.",
      },
    },
  },
  argTypes: {
    data: { control: "object", description: "Node list with value, label and optional children." },
    expanded: { control: "object", description: "Controlled list of expanded node values." },
    levelOffset: {
      control: { type: "range", min: 8, max: 40, step: 4 },
      description: "Horizontal indent per depth level (default 16px).",
    },
    onExpandedChange: { action: "expanded changed", description: "Called with the next list of expanded values." },
    onNodeClick: { action: "node clicked", description: "Called with the clicked node." },
  },
  args: { levelOffset: 16 },
};
export default meta;
type Story = StoryObj;

const demoData: UITreeNode[] = [
  {
    value: "fno",
    label: "F&O",
    children: [
      { value: "nifty", label: "NIFTY" },
      { value: "banknifty", label: "BANKNIFTY" },
    ],
  },
  {
    value: "cash",
    label: "Cash",
    children: [
      { value: "reliance", label: "RELIANCE" },
      { value: "tcs", label: "TCS" },
    ],
  },
];

export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [expanded, setExpanded] = createSignal<string[]>(args.expanded ?? ["fno"]);
      return (
        <Page>
          <Specimen title="Playground" code={`levelOffset={${String(args.levelOffset ?? 16)}}`} note="F&O starts expanded; children are real nodes.">
            <Stack gap="sm">
              <Readout>expanded: {JSON.stringify(expanded())}</Readout>
              <Tree
                data={args.data ?? demoData}
                expanded={expanded()}
                levelOffset={args.levelOffset ?? 16}
                onExpandedChange={setExpanded}
                {...({ "aria-label": "Universe tree" } as Record<string, unknown>)}
              />
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const ExpandedAndCollapsed: Story = {
  render: () =>
    solidStory(() => {
      const [expanded, setExpanded] = createSignal<string[]>(["fno"]);
      const all = demoData.map((node) => node.value);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="Controlled expanded" note="One branch starts open; the readout reflects the controlled list.">
              <Stack gap="sm">
                <Readout>expanded: {JSON.stringify(expanded())}</Readout>
                <Tree data={demoData} expanded={expanded()} onExpandedChange={setExpanded} levelOffset={20} />
                <Group gap="xs">
                  <button type="button" aria-label="Expand all branches" onClick={() => setExpanded(all)}>Expand all</button>
                  <button type="button" aria-label="Collapse all branches" onClick={() => setExpanded([])}>Collapse all</button>
                </Group>
              </Stack>
            </Specimen>
            <Specimen title="Uncontrolled" note="No expanded prop: Tree keeps its own signal and starts fully collapsed.">
              <Stack gap="sm">
                <Text size="xs" c="dimmed">Click a chevron to open its branch.</Text>
                <Tree data={demoData} levelOffset={20} />
              </Stack>
            </Specimen>
          </SpecimenGrid>
        </Page>
      );
    }),
};

export const Selection: Story = {
  render: () =>
    solidStory(() => {
      const [expanded, setExpanded] = createSignal<string[]>(["fno"]);
      const [selected, setSelected] = createSignal<string | null>("nifty");
      return (
        <Page>
          <Specimen
            title="Selected node"
            note="Selection is caller state: onNodeClick sets it and renderNode styles the label with the primary token."
          >
            <Stack gap="sm">
              <Readout>selected: {selected() ?? "none"}</Readout>
              <Tree
                data={demoData}
                expanded={expanded()}
                onExpandedChange={setExpanded}
                levelOffset={20}
                onNodeClick={(node) => setSelected(node.value)}
                renderNode={({ node, expanded: isOpen, hasChildren }) => (
                  <button
                    type="button"
                    aria-label={`Select ${node.label}`}
                    aria-pressed={selected() === node.value}
                    aria-expanded={hasChildren ? isOpen : undefined}
                    style={{
                      border: "none",
                      "border-radius": "4px",
                      padding: "2px 6px",
                      background: selected() === node.value ? "var(--color-fin-surface-alt)" : "transparent",
                      color: selected() === node.value ? "var(--color-fin-primary)" : "var(--color-fin-text)",
                      "font-weight": selected() === node.value ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {node.label}
                  </button>
                )}
              />
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

const disabledData: UITreeNode[] = [
  {
    value: "fno",
    label: "F&O",
    children: [
      { value: "nifty", label: "NIFTY" },
      { value: "banknifty", label: "BANKNIFTY", disabled: true },
    ],
  },
  { value: "cash", label: "Cash (unavailable)", disabled: true },
];

export const DisabledNodes: Story = {
  render: () =>
    solidStory(() => {
      const disabledValues = new Set(["banknifty", "cash"]);
      const [expanded, setExpanded] = createSignal<string[]>(["fno"]);
      const [last, setLast] = createSignal("none");
      return (
        <Page>
          <Specimen
            title="Disabled nodes"
            note="No disabled prop exists. The handlers ignore flagged nodes and renderNode labels them with full-contrast muted copy."
          >
            <Stack gap="sm">
              <Readout>last action: {last()}</Readout>
              <Tree
                data={disabledData}
                expanded={expanded()}
                onExpandedChange={(next) => setExpanded(next.filter((value) => !disabledValues.has(value)))}
                onNodeClick={(node) => {
                  if (!disabledValues.has(node.value)) setLast(node.value);
                }}
                levelOffset={20}
                renderNode={({ node }) => (
                  <span
                    role="button"
                    aria-label={`${node.label}${node.disabled ? " (unavailable)" : ""}`}
                    aria-disabled={node.disabled ? "true" : undefined}
                    style={{ color: node.disabled ? "var(--color-fin-text-muted)" : "var(--color-fin-text)" }}
                  >
                    {node.label}
                    {node.disabled ? <Text span size="xs" c="dimmed"> · unavailable</Text> : null}
                  </span>
                )}
              />
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => {
      const [expanded, setExpanded] = createSignal<string[]>(["fno"]);
      const [selected, setSelected] = createSignal<UITreeNode | null>(null);
      return (
        <Page>
          <Specimen title="Instrument universe" note="Pick a node to inspect it in the detail column.">
            <Box
              style={{
                display: "grid",
                gap: "16px",
                "grid-template-columns": "repeat(auto-fit, minmax(260px, 1fr))",
                "align-items": "start",
                width: "100%",
              }}
            >
              <Tree
                data={demoData}
                expanded={expanded()}
                onExpandedChange={setExpanded}
                onNodeClick={setSelected}
                levelOffset={18}
                {...({ "aria-label": "Instrument universe" } as Record<string, unknown>)}
              />
              <Stack gap="xs" style={{ "border-left": "1px solid var(--color-fin-border)", padding: "8px 16px" }}>
                <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Selection detail</Text>
                {selected() ? (
                  <>
                    <Group gap="xs" wrap="wrap">
                      <Badge size="xs" color="primary">{selected()?.value}</Badge>
                      <Badge size="xs" color="info">{selected()?.children ? "branch" : "leaf"}</Badge>
                    </Group>
                    <Text size="sm">{selected()?.label}</Text>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">Pick a node in the tree to inspect it.</Text>
                )}
              </Stack>
            </Box>
          </Specimen>
        </Page>
      );
    }),
};
