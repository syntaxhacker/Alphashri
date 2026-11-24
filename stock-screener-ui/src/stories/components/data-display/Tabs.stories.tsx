import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Badge, Group, Stack, Tab, Tabs, TabsList, TabsPanel, Text, typeStyle } from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Data display/Tabs",
  tags: ["autodocs"],
  component: Tabs as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Tabs is a controlled-or-uncontrolled wrapper around TabsList / Tab / TabsPanel. `value` and `onChange` make it controlled; `defaultValue` seeds the uncontrolled branch. `orientation` flips the wrapper into a row/column, but TabsList reads its own `orientation` prop rather than context — set it on both for a true vertical strip. Every Tab accepts `value`, `disabled`, `icon`, `leftSection` and `rightSection`. There is no `size` prop: the strip is built around a 30px control height, so the Sizes story composes explicit inline styles on the real Tab instead of inventing one.",
      },
    },
  },
  argTypes: {
    value: { control: "text", description: "Controlled active tab value. Omit for uncontrolled usage." },
    defaultValue: { control: "text", description: "Initial value when uncontrolled." },
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
      description: "Set on Tabs and TabsList: vertical renders the list and panels side by side.",
    },
    onChange: { action: "tab changed", description: "Called with the selected value, or null." },
  },
  args: { orientation: "horizontal", defaultValue: "overview" },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<string | null>(args.value ?? args.defaultValue ?? "overview");
      return (
        <Page>
          <Specimen title="Playground" code={`orientation="${String(args.orientation)}"`}>
            <Stack gap="sm">
              <Readout>Viewing {value() ?? "no section"}</Readout>
              <Tabs
                value={value()}
                onChange={(next) => setValue(next)}
                orientation={args.orientation}
                {...({ "aria-label": "Market sections" } as Record<string, unknown>)}
              >
                <TabsList orientation={args.orientation} {...({ "aria-label": "Market section tabs" } as Record<string, unknown>)}>
                  <Tab value="overview">Overview</Tab>
                  <Tab value="flow">Flow</Tab>
                  <Tab value="levels">Levels</Tab>
                </TabsList>
                <TabsPanel value="overview" style={{ padding: "8px" }}>
                  <SampleRow label="Regime" value="trend · fresh frame" tone="var(--color-fin-primary)" />
                </TabsPanel>
                <TabsPanel value="flow" style={{ padding: "8px" }}>
                  <SampleRow label="Delivery" value="42% of volume" />
                </TabsPanel>
                <TabsPanel value="levels" style={{ padding: "8px" }}>
                  <SampleRow label="Call wall" value="23,500" tone="var(--color-fin-negative)" />
                </TabsPanel>
              </Tabs>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Orientations: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen
            title="Orientation"
            code='orientation="horizontal"'
            note="The default: one continuous rule under a row of tabs."
          >
            <Tabs defaultValue="a" orientation="horizontal" {...({ "aria-label": "Horizontal tabs demo" } as Record<string, unknown>)}>
              <TabsList {...({ "aria-label": "Horizontal sections" } as Record<string, unknown>)}>
                <Tab value="a">Scan</Tab>
                <Tab value="b">Filter</Tab>
                <Tab value="c">Commit</Tab>
              </TabsList>
              <TabsPanel value="a" style={{ padding: "8px" }}><Text size="xs">Scan panel · 214 symbols in the universe.</Text></TabsPanel>
              <TabsPanel value="b" style={{ padding: "8px" }}><Text size="xs">Filter panel · 18 rows passed the gates.</Text></TabsPanel>
              <TabsPanel value="c" style={{ padding: "8px" }}><Text size="xs">Commit panel · 1 structure staged.</Text></TabsPanel>
            </Tabs>
          </Specimen>
          <Specimen
            title="Orientation"
            code='orientation="vertical"'
            note="The wrapper switches to flex-row and the list to flex-col; panels sit to the right."
          >
            <Tabs
              defaultValue="a"
              orientation="vertical"
              style={{ "min-height": "168px" }}
              {...({ "aria-label": "Vertical tabs demo" } as Record<string, unknown>)}
            >
              <TabsList orientation="vertical" {...({ "aria-label": "Vertical sections" } as Record<string, unknown>)}>
                <Tab value="a">Scan</Tab>
                <Tab value="b">Filter</Tab>
                <Tab value="c">Commit</Tab>
              </TabsList>
              <TabsPanel value="a" style={{ padding: "8px" }}><Text size="xs">Scan panel · the strip stays on the left.</Text></TabsPanel>
              <TabsPanel value="b" style={{ padding: "8px" }}><Text size="xs">Filter panel · active tab is underlined.</Text></TabsPanel>
              <TabsPanel value="c" style={{ padding: "8px" }}><Text size="xs">Commit panel · paper book only.</Text></TabsPanel>
            </Tabs>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

const tabSizeStyles: Record<string, JSX.CSSProperties> = {
  compact: { "min-height": "24px", padding: "0 8px", ...typeStyle("micro") },
  default: { "min-height": "30px", padding: "0 12px", ...typeStyle("micro") },
  roomy: { "min-height": "38px", padding: "0 16px", ...typeStyle("body") },
};

export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          {(["compact", "default", "roomy"] as const).map((name) => (
            <Specimen title={`Tab style · ${name}`} code={`min-height: ${tabSizeStyles[name]["min-height"]}`}>
              <Tabs defaultValue="one" {...({ "aria-label": `${name} tabs` } as Record<string, unknown>)}>
                <TabsList {...({ "aria-label": `${name} sections` } as Record<string, unknown>)}>
                  <Tab value="one" style={tabSizeStyles[name]}>One</Tab>
                  <Tab value="two" style={tabSizeStyles[name]}>Two</Tab>
                  <Tab value="three" style={tabSizeStyles[name]}>Three</Tab>
                </TabsList>
                <TabsPanel value="one" style={{ padding: "8px" }}><Text size="xs">Panel one · dense toolbar.</Text></TabsPanel>
                <TabsPanel value="two" style={{ padding: "8px" }}><Text size="xs">Panel two · default control height.</Text></TabsPanel>
                <TabsPanel value="three" style={{ padding: "8px" }}><Text size="xs">Panel three · roomy control height.</Text></TabsPanel>
              </Tabs>
            </Specimen>
          ))}
        </SpecimenGrid>
      </Page>
    )),
};

export const DisabledTab: Story = {
  render: () =>
    solidStory(() => {
      const [value, setValue] = createSignal<string | null>("overview");
      return (
        <Page>
          <Specimen
            title="Disabled tab"
            note="Locked is a native disabled button, so Overview stays selected when it is clicked."
          >
            <Stack gap="sm">
              <Readout>Viewing {value() ?? "no section"} · the locked section stays unavailable</Readout>
              <Tabs value={value()} onChange={setValue} {...({ "aria-label": "Tabs with a disabled item" } as Record<string, unknown>)}>
                <TabsList {...({ "aria-label": "Sections including locked" } as Record<string, unknown>)}>
                  <Tab value="overview">Overview</Tab>
                  <Tab value="flow">Flow</Tab>
                  <Tab value="locked" disabled>Locked</Tab>
                </TabsList>
                <TabsPanel value="overview" style={{ padding: "8px" }}>
                  <SampleRow label="Breadth" value="128 up / 74 down" />
                </TabsPanel>
                <TabsPanel value="flow" style={{ padding: "8px" }}>
                  <SampleRow label="Delivery" value="42% of volume" />
                </TabsPanel>
              </Tabs>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Composition" note="Panels mount only while active unless keepMounted is set.">
          <Tabs defaultValue="signals" {...({ "aria-label": "Research tabs" } as Record<string, unknown>)}>
            <TabsList {...({ "aria-label": "Research sections" } as Record<string, unknown>)}>
              <Tab value="signals" leftSection={<Badge size="xs" color="primary">3</Badge>}>Signals</Tab>
              <Tab value="risk" leftSection={<Badge size="xs" color="warning">1</Badge>}>Risk</Tab>
              <Tab value="notes">Notes</Tab>
            </TabsList>
            <TabsPanel value="signals" style={{ padding: "8px" }}>
              <Stack gap="sm">
                <Text size="xs">Three signals passed the pre-flight checklist.</Text>
                <Group gap="xs" wrap="wrap">
                  <Badge size="xs" color="success">fresh frame</Badge>
                  <Badge size="xs" color="info">in session</Badge>
                </Group>
              </Stack>
            </TabsPanel>
            <TabsPanel value="risk" style={{ padding: "8px" }}>
              <SampleRow label="Exposure" value="91% of cap" tone="var(--color-fin-warning)" />
            </TabsPanel>
            <TabsPanel value="notes" style={{ padding: "8px" }}>
              <Text size="xs" c="dimmed">No notes for this session.</Text>
            </TabsPanel>
          </Tabs>
        </Specimen>
      </Page>
    )),
};
