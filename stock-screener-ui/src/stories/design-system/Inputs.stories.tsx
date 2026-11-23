import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Badge, Box, Button, Card, Checkbox, Divider, Flex, NumberInput, Paper,
  SegmentedControl, Select, Stack, Switch, Text, TextInput, Title,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Inputs",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the local input primitives. Controls here carry real labels, real size props and signal-driven values; every variant matrix lives on the per-component docs pages under Design System/Components/Inputs/*.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

// Links must leave the preview iframe and open the Storybook manager.
const docsHref = (id: string) => `../?path=/docs/${id}`;

const DocsCard = (props: { id: string; label: string; note: string }) => (
  <Paper p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="xs">
      <Anchor href={docsHref(props.id)} target="_top" c="primary" fw={600} size="sm" underline="hover">
        {props.label}
      </Anchor>
      <Text size="xs" c="dimmed">{props.note}</Text>
    </Stack>
  </Paper>
);

const PropChip = (props: { name: string; value: string }) => (
  <Flex
    gap="xs"
    align="center"
    wrap="wrap"
    style={{
      padding: "8px 10px",
      "border-radius": "6px",
      border: `1px solid ${palette.BORDER}`,
      background: palette.SURFACE_ALT,
    }}
  >
    <Text size="xs" fw={600} className="font-mono">{props.name}</Text>
    <Text size="xs" c="dimmed" className="font-mono">{props.value}</Text>
  </Flex>
);

const Section = (props: { eyebrow: string; title: string; note: string; children: JSX.Element }) => (
  <Box component="section" style={{ width: "100%" }}>
    <Stack gap="sm">
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">{props.eyebrow}</Text>
        <Title order={2} size="md">{props.title}</Title>
        <Text size="sm" c="dimmed">{props.note}</Text>
      </Stack>
      {props.children}
    </Stack>
  </Box>
);

const UNIVERSE_OPTIONS = [
  { value: "nifty50", label: "NIFTY 50" },
  { value: "nifty500", label: "NIFTY 500" },
  { value: "banknifty", label: "BANKNIFTY" },
];
const VIEW_OPTIONS = [
  { value: "table", label: "TABLE" },
  { value: "grid", label: "GRID" },
  { value: "matrix", label: "MATRIX" },
];

/** One composite specimen: a screen filter whose switches and segmented control really update. */
const Specimen = () => {
  const [view, setView] = createSignal("table");
  const [live, setLive] = createSignal(true);
  return (
    <div
      style={{
        background: palette.BG,
        padding: "16px",
        "border-radius": "6px",
        border: `1px solid ${palette.BORDER}`,
      }}
    >
      <Flex gap="md" align="stretch" wrap="wrap">
        <Box
          style={{
            flex: "1 1 320px",
            "min-width": "0",
            background: palette.SURFACE,
            border: `1px solid ${palette.BORDER}`,
            "border-radius": "6px",
            padding: "12px",
          }}
        >
          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Screen filter</Text>
            <Flex gap="sm" align="flex-start" wrap="wrap">
              <Select size="sm" w={168} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
              <NumberInput size="sm" w={104} label="Min score" defaultValue={80} min={0} max={100} hideControls />
            </Flex>
            <Flex gap="sm" align="center" wrap="wrap">
              <Switch
                label="Live quotes"
                checked={live()}
                onChange={(event) => setLive(event.currentTarget.checked)}
              />
              <Text size="xs" c="dimmed">{live() ? "quotes on" : "quotes paused"}</Text>
            </Flex>
            <Flex gap="sm" align="center" wrap="wrap">
              <Button size="sm">Run screen</Button>
              <Button size="sm" variant="outline">Reset</Button>
            </Flex>
          </Stack>
        </Box>
        <Box
          style={{
            flex: "0 1 240px",
            "min-width": "0",
            background: palette.SURFACE,
            border: `1px solid ${palette.BORDER}`,
            "border-radius": "6px",
            padding: "12px",
          }}
        >
          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Result view</Text>
            <SegmentedControl
              aria-label="Result view"
              value={view()}
              onChange={setView}
              data={VIEW_OPTIONS}
            />
            <Text size="xs" c="dimmed">{`selected: ${view()}`}</Text>
            <Divider />
            <Text size="xs" c="dimmed">
              Every control keeps its real props: a visible label or aria-label, a size, and a signal for its value.
            </Text>
          </Stack>
        </Box>
      </Flex>
    </div>
  );
};

const PROPS = [
  { name: "size", value: "xs 24px · sm 30px · md 34px · lg 38px" },
  { name: "Button variant", value: "filled · light · outline · subtle · transparent" },
  { name: "Button color", value: "primary · success · error · warning" },
  { name: "width", value: "fields default fullWidth — pass w inside a row" },
  { name: "label", value: "visible label or aria-label on every control" },
  { name: "state", value: "disabled · loading · error where supported" },
];

const COMPONENTS = [
  { id: "design-system-components-inputs-button--docs", label: "Button", note: "Variants, sizes, tones and loading." },
  { id: "design-system-components-inputs-actionicon--docs", label: "ActionIcon", note: "Icon-only control with an aria-label." },
  { id: "design-system-components-inputs-unstyledbutton--docs", label: "UnstyledButton", note: "Behaviour without the button skin." },
  { id: "design-system-components-inputs-textinput--docs", label: "TextInput", note: "Single-line text with label and sections." },
  { id: "design-system-components-inputs-numberinput--docs", label: "NumberInput", note: "Numeric bounds and step controls." },
  { id: "design-system-components-inputs-textarea--docs", label: "Textarea", note: "Multi-line notes and theses." },
  { id: "design-system-components-inputs-passwordinput--docs", label: "PasswordInput", note: "Masked text with visibility toggle." },
  { id: "design-system-components-inputs-select--docs", label: "Select", note: "Single choice from a data list." },
  { id: "design-system-components-inputs-multiselect--docs", label: "MultiSelect", note: "Multiple choices with removable values." },
  { id: "design-system-components-inputs-segmentedcontrol--docs", label: "SegmentedControl", note: "Small exclusive view switcher." },
  { id: "design-system-components-inputs-checkbox--docs", label: "Checkbox", note: "Boolean with label and description." },
  { id: "design-system-components-inputs-switch--docs", label: "Switch", note: "On/off setting with a live readout." },
  { id: "design-system-components-inputs-chip--docs", label: "Chip", note: "Compact selectable filter." },
  { id: "design-system-components-inputs-slider--docs", label: "Slider", note: "Single numeric range." },
  { id: "design-system-components-inputs-rangeslider--docs", label: "RangeSlider", note: "Lower and upper numeric bounds." },
  { id: "design-system-components-inputs-datepicker--docs", label: "DatePicker", note: "Calendar date selection." },
  { id: "design-system-components-inputs-copybutton--docs", label: "CopyButton", note: "Copy-to-clipboard feedback." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1100px" }}>
        <Card p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="md">
            <Flex gap="sm" align="center" wrap="wrap">
              <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Design system / Inputs</Text>
              <Badge size="xs" color="info">17 component pages</Badge>
            </Flex>
            <Stack gap="xs">
              <Title order={1} size="xl">Inputs</Title>
              <Text size="sm" c="dimmed">
                Buttons, fields, selectors and toggles that keep one size scale, one focus ring and one labelling contract.
              </Text>
            </Stack>
            <Box style={{ "border-top": `1px solid ${palette.BORDER}`, "padding-top": "16px" }}>
              <Specimen />
            </Box>
          </Stack>
        </Card>

        <Section
          eyebrow="Tokens & props"
          title="What Inputs owns"
          note="Real props from the input implementations. No synthetic controls: every value below is either a documented size/props row or a live control in the specimen."
        >
          <Flex gap="sm" wrap="wrap">
            {PROPS.map((prop) => <PropChip name={prop.name} value={prop.value} />)}
          </Flex>
        </Section>

        <Section
          eyebrow="Index"
          title="Components in this family"
          note="Seventeen component pages hold the full state and variant matrices; the landing page keeps one realistic filter composition."
        >
          <Box
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "8px",
            }}
          >
            {COMPONENTS.map((component) => (
              <DocsCard id={component.id} label={component.label} note={component.note} />
            ))}
          </Box>
        </Section>
      </Stack>
    )),
};

/** The remaining family-level demo: size and state at a glance, with real controls. */
export const SizesAndStates: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md" style={{ "max-width": "820px" }}>
        <Section
          eyebrow="Real demo"
          title="Sizes and states"
          note="Control heights follow the shared size scale; labelled fields carry an explicit width when they share a row."
        >
          <Flex gap="sm" align="center" wrap="wrap">
            <Button size="xs">xs · 24px</Button>
            <Button size="sm">sm · 30px</Button>
            <Button size="sm" variant="outline">outline</Button>
            <Button size="sm" color="success">success</Button>
            <Button size="sm" loading>loading</Button>
            <Button size="sm" disabled>disabled</Button>
          </Flex>
          <Divider label="Input row" labelPosition="left" />
          <Flex gap="sm" align="flex-start" wrap="wrap">
            <Select size="sm" w={180} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
            <NumberInput size="sm" w={104} label="Min score" defaultValue={80} min={0} max={100} hideControls />
            <TextInput size="sm" w={180} label="Symbol" defaultValue="NIFTY" />
            <Checkbox label="Include expired" defaultChecked />
          </Flex>
        </Section>
      </Stack>
    )),
};
