import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Accordion, AccordionControl, AccordionItem, AccordionPanel, Badge, Group, Stack, Text,
} from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Data display/Accordion",
  tags: ["autodocs"],
  component: Accordion as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Accordion owns a single string or a string[] when `multiple` is set. `defaultValue` seeds the uncontrolled branch; `value` + `onChange` make it controlled. `variant` picks default / contained / filled / separated chrome, `chevronPosition` moves the chevron and `disableChevronRotation` freezes it. There is no `disabled` prop — the DisabledItem story composes one by forwarding `disabled` and `aria-disabled` to the real AccordionControl button.",
      },
    },
  },
  argTypes: {
    multiple: { control: "boolean", description: "Allow more than one open item; value becomes a string[]." },
    defaultValue: { control: "text", description: "Initially open item value(s) when uncontrolled." },
    value: { control: "text", description: "Controlled open item value(s)." },
    onChange: { action: "accordion changed", description: "Called with the next string or string[]." },
    variant: {
      control: "select",
      options: ["default", "contained", "filled", "separated"],
      description: "Wrapper chrome: separated adds a gap, contained adds a border, filled tints items.",
    },
    chevronPosition: { control: "inline-radio", options: ["left", "right"], description: "Which side renders the chevron." },
    disableChevronRotation: { control: "boolean", description: "Keep the chevron upright when expanded." },
  },
  args: { variant: "separated", multiple: false, defaultValue: "filters", chevronPosition: "right" },
};
export default meta;
type Story = StoryObj;

const Sections = () => (
  <>
    <AccordionItem value="filters">
      <AccordionControl>Filters</AccordionControl>
      <AccordionPanel>
        <Stack gap="xs" style={{ padding: "8px" }}>
          <Group gap="xs" wrap="wrap">
            <Badge size="xs" color="primary">sector: IT</Badge>
            <Badge size="xs" color="info">cap: large</Badge>
          </Group>
          <Text size="xs" c="dimmed">Sector, cap tier and quality gates applied to the universe.</Text>
        </Stack>
      </AccordionPanel>
    </AccordionItem>
    <AccordionItem value="risk">
      <AccordionControl>Risk controls</AccordionControl>
      <AccordionPanel>
        <Stack gap="xs" style={{ padding: "8px" }}>
          <SampleRow label="Position size" value="1 lot" />
          <SampleRow label="Daily loss limit" value="2%" />
        </Stack>
      </AccordionPanel>
    </AccordionItem>
    <AccordionItem value="execution">
      <AccordionControl>Execution</AccordionControl>
      <AccordionPanel>
        <Text size="xs" c="dimmed" style={{ padding: "8px" }}>
          Slippage, cooldown and entry timing for the paper book.
        </Text>
      </AccordionPanel>
    </AccordionItem>
  </>
);

export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [value, setValue] = createSignal<string | string[] | null>(args.value ?? args.defaultValue ?? null);
      return (
        <Page>
          <Specimen
            title="Playground"
            code={`variant="${String(args.variant)}" · chevronPosition="${String(args.chevronPosition)}"`}
            note="Controlled value below; click a control to change the open branch."
          >
            <Stack gap="sm">
              <Readout>open: {JSON.stringify(value())}</Readout>
              <Accordion
                multiple={args.multiple}
                variant={args.variant}
                chevronPosition={args.chevronPosition}
                disableChevronRotation={args.disableChevronRotation}
                value={value() as string | string[]}
                onChange={(next) => setValue(next)}
              >
                <Sections />
              </Accordion>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const SingleAndMultiple: Story = {
  render: () =>
    solidStory(() => {
      const [single, setSingle] = createSignal<string | string[] | null>("filters");
      const [multiple, setMultiple] = createSignal<string | string[] | null>(["filters", "execution"]);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="single" note="One string value; opening another closes the first.">
              <Stack gap="sm">
                <Readout>open: {String(single())}</Readout>
                <Accordion value={single() as string | string[]} onChange={setSingle} variant="separated">
                  <Sections />
                </Accordion>
              </Stack>
            </Specimen>
            <Specimen title="multiple" note="A string[] value; sections toggle independently.">
              <Stack gap="sm">
                <Readout>open: {JSON.stringify(multiple())}</Readout>
                <Accordion multiple value={multiple() as string | string[]} onChange={setMultiple} variant="separated">
                  <Sections />
                </Accordion>
              </Stack>
            </Specimen>
          </SpecimenGrid>
        </Page>
      );
    }),
};

export const DefaultOpenAndChevron: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="defaultValue" code='defaultValue="risk"' note="The component seeds the open branch.">
            <Accordion defaultValue="risk" variant="separated" {...({ "aria-label": "Default open accordion" } as Record<string, unknown>)}>
              <Sections />
            </Accordion>
          </Specimen>
          <Specimen
            title="chevron chrome"
            code='chevronPosition="left" · disableChevronRotation'
            note="Only the control chrome moves; the panel content is unchanged."
          >
            <Accordion defaultValue="filters" variant="separated" chevronPosition="left" disableChevronRotation>
              <Sections />
            </Accordion>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Variants: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid min={320}>
          {(["default", "contained", "filled", "separated"] as const).map((variant) => (
            <Specimen title="variant" code={`variant="${variant}"`} note="Filters starts expanded in this specimen.">
              <Accordion defaultValue="filters" variant={variant}>
                <Sections />
              </Accordion>
            </Specimen>
          ))}
        </SpecimenGrid>
      </Page>
    )),
};

const LockedControl = (props: { children: JSX.Element }) => (
  <AccordionControl
    className="cursor-not-allowed"
    {...({
      disabled: true,
      "aria-disabled": "true",
      title: "Unavailable in this demo",
      style: { color: "var(--color-fin-text-muted)", "font-style": "italic" },
    } as Record<string, unknown>)}
  >
    {props.children}
  </AccordionControl>
);

export const DisabledItem: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Disabled item"
          note="Accordion has no disabled prop. The locked control forwards `disabled` to its native button and labels itself with `aria-disabled`; its panel cannot be reached by clicking it."
        >
          <Accordion defaultValue="filters" variant="separated">
            <AccordionItem value="filters">
              <AccordionControl>Filters</AccordionControl>
              <AccordionPanel>
                <Text size="xs" c="dimmed" style={{ padding: "8px" }}>Editable section.</Text>
              </AccordionPanel>
            </AccordionItem>
            <AccordionItem value="locked">
              <LockedControl>Export (unavailable)</LockedControl>
              <AccordionPanel>
                <Text size="xs" c="dimmed" style={{ padding: "8px" }}>This panel is unreachable from the locked control.</Text>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </Specimen>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Composition" note="Panels keep real UI children; hidden panels stay in the DOM with hidden=true.">
          <Accordion defaultValue="universe" variant="contained">
            <AccordionItem value="universe">
              <AccordionControl>Universe</AccordionControl>
              <AccordionPanel>
                <Group gap="xs" style={{ padding: "8px" }}>
                  <Badge size="xs" color="primary">NIFTY</Badge>
                  <Badge size="xs" color="info">BANKNIFTY</Badge>
                  <Text size="xs" c="dimmed">2 indices selected</Text>
                </Group>
              </AccordionPanel>
            </AccordionItem>
            <AccordionItem value="checks">
              <AccordionControl>Pre-flight</AccordionControl>
              <AccordionPanel>
                <Stack gap="xs" style={{ padding: "8px" }}>
                  <SampleRow label="Frame" value="fresh · session pinned" tone="var(--color-fin-positive)" />
                  <SampleRow label="Limits" value="verified" tone="var(--color-fin-positive)" />
                </Stack>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </Specimen>
      </Page>
    )),
};
