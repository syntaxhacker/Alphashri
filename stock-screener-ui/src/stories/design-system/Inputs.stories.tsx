import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Box, Button, Checkbox, Divider, Flex, NumberInput,
  SegmentedControl, Select, Stack, Switch, Text, TextInput,
} from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyChip, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

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
  const viewLabel = () => VIEW_OPTIONS.find((option) => option.value === view())?.label.toLowerCase() ?? "table";
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
                onChange={setLive}
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
            <Text size="xs" c="dimmed">Showing the {viewLabel()} view.</Text>
            <Divider />
            <Text size="xs" c="dimmed">
              Each control carries a clear label and follows the shared size scale.
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

const COMPONENTS: FamilyComponentRef[] = [
  { id: "design-system-components-inputs-button--docs", name: "Button", note: "Variants, sizes, tones and loading." },
  { id: "design-system-components-inputs-actionicon--docs", name: "ActionIcon", note: "Icon-only control with an aria-label." },
  { id: "design-system-components-inputs-unstyledbutton--docs", name: "UnstyledButton", note: "Behaviour without the button skin." },
  { id: "design-system-components-inputs-textinput--docs", name: "TextInput", note: "Single-line text with label and sections." },
  { id: "design-system-components-inputs-numberinput--docs", name: "NumberInput", note: "Numeric bounds and step controls." },
  { id: "design-system-components-inputs-textarea--docs", name: "Textarea", note: "Multi-line notes and theses." },
  { id: "design-system-components-inputs-passwordinput--docs", name: "PasswordInput", note: "Masked text with visibility toggle." },
  { id: "design-system-components-inputs-select--docs", name: "Select", note: "Single choice from a data list." },
  { id: "design-system-components-inputs-multiselect--docs", name: "MultiSelect", note: "Multiple choices with removable values." },
  { id: "design-system-components-inputs-segmentedcontrol--docs", name: "SegmentedControl", note: "Small exclusive view switcher." },
  { id: "design-system-components-inputs-checkbox--docs", name: "Checkbox", note: "Boolean with label and description." },
  { id: "design-system-components-inputs-switch--docs", name: "Switch", note: "On/off setting with a live readout." },
  { id: "design-system-components-inputs-chip--docs", name: "Chip", note: "Compact selectable filter." },
  { id: "design-system-components-inputs-slider--docs", name: "Slider", note: "Single numeric range." },
  { id: "design-system-components-inputs-rangeslider--docs", name: "RangeSlider", note: "Lower and upper numeric bounds." },
  { id: "design-system-components-inputs-datepicker--docs", name: "DatePicker", note: "Calendar date selection." },
  { id: "design-system-components-inputs-copybutton--docs", name: "CopyButton", note: "Copy-to-clipboard feedback." },
];

export const Landing: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage width="1100px" padding="0">
        <FamilyHero
          name="Inputs"
          count={17}
          caption="screen filter"
          purpose="Buttons, fields, selectors and toggles that keep one size scale, one focus ring and one labelling contract."
          specimen={<Specimen />}
        />

        <SpecimenPanel
          title="What Inputs owns"
          note="Real props from the input implementations. No synthetic controls: every value below is either a documented size/props row or a live control in the specimen."
        >
          <Flex gap="sm" wrap="wrap">
            {PROPS.map((prop) => <FamilyChip name={prop.name} value={prop.value} />)}
          </Flex>
        </SpecimenPanel>

        <ComponentIndex
          items={COMPONENTS}
          note="Seventeen component pages hold the full state and variant matrices; the landing page keeps one realistic filter composition."
        />
        <FamilyFooter source="src/ui/inputs" pages="src/stories/components/inputs" />
      </FamilyPage>
    )),
};

/** Real focusable controls: the first field is focused so the treatment is visible on load. */
const FocusSpecimen = () => {
  const [live, setLive] = createSignal(false);
  return (
    <Flex gap="sm" align="flex-end" wrap="wrap">
      <TextInput size="sm" w={200} label="Symbol" defaultValue="NIFTY" autoFocus />
      <Select size="sm" w={180} label="Universe" defaultValue="nifty500" data={UNIVERSE_OPTIONS} />
      <Switch label="Live quotes" checked={live()} onChange={setLive} />
      <Button size="sm">Run screen</Button>
    </Flex>
  );
};

/** The remaining family-level demo: size and state at a glance, with real controls. */
export const SizesAndStates: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage width="820px" padding="0">
        <SpecimenPanel
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
        </SpecimenPanel>
        <SpecimenPanel
          title="Focus states"
          note="Real controls with their focus treatment; press Tab or Shift+Tab to move through them."
        >
          <FocusSpecimen />
        </SpecimenPanel>
      </FamilyPage>
    )),
};
