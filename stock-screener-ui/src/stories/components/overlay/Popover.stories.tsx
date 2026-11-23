import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Flex, Group, Popover, PopoverDropdown, PopoverTarget, Stack, Text } from "@/ui";
import type { UIPopoverProps } from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid, Stage } from "./fixtures";

const positions = [
  "top", "top-start", "top-end",
  "bottom", "bottom-start", "bottom-end",
  "left", "left-start", "left-end",
  "right", "right-start", "right-end",
] as const satisfies readonly NonNullable<UIPopoverProps["position"]>[];

const meta: Meta = {
  title: "Design System/Components/Overlay/Popover",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: Popover as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Popover is a compound primitive: Popover, PopoverTarget and PopoverDropdown. It is controlled with `opened` + `onChange` or uncontrolled by toggling the target. The dropdown is positioned from the anchor rect with `position`, `offset` and `width`; Escape and a click outside close it by default. `trapFocus` is accepted for Mantine compatibility but is not implemented in this primitive — focus is not moved into the dropdown and Tab is not captured.",
      },
    },
  },
  argTypes: {
    opened: { control: "boolean", description: "Controlled open state." },
    onChange: { action: "onChange", description: "Called with the next opened state." },
    onClose: { action: "onClose", description: "Called after dismissal." },
    position: { control: "select", options: [...positions], description: "Anchor-relative placement." },
    width: { control: "text", description: "Dropdown width: a number becomes px, a string is used verbatim." },
    offset: { control: { type: "number", min: 0, step: 2 }, description: "Gap from the anchor in px." },
    shadow: { control: "select", options: ["sm", "md", "lg", "xl"], description: "Shadow preset on the dropdown." },
    withArrow: { control: "boolean", description: "Accepted for compatibility; the local dropdown draws no arrow." },
    trapFocus: { control: "boolean", description: "Accepted but not implemented — Tab is not captured." },
    closeOnClickOutside: { control: "boolean", description: "mousedown outside closes the dropdown (default true)." },
  },
};
export default meta;
type Story = StoryObj;

export const OpenDropdown: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Open dropdown"
          code="opened · width={300}"
          note="Frozen controlled state with realistic settings content; the dropdown renders under its target."
        >
          <Stage height={208}>
            <Popover opened position="bottom-start" width={300} shadow="md" closeOnClickOutside={false}>
              <PopoverTarget>
                <Button size="sm" variant="outline">Structure settings</Button>
              </PopoverTarget>
              <PopoverDropdown p="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>Structure settings</Text>
                  <SampleRow label="Universe" value="NIFTY 500" />
                  <SampleRow label="Legs" value="2 · debit spread" />
                  <Text size="xs" c="dimmed">Escape and an outside click dismiss the live control.</Text>
                </Stack>
              </PopoverDropdown>
            </Popover>
          </Stage>
        </Specimen>
      </Page>
    )),
};

export const Positions: Story = {
  render: () =>
    solidStory(() => {
      const [position, setPosition] = createSignal<UIPopoverProps["position"]>("bottom-start");
      const [opened, setOpened] = createSignal(false);
      return (
        <Page>
          <Specimen title="Positions" note="Pick an anchor-relative placement, then toggle the target; the dropdown is measured from its rect.">
            <Stack gap="sm">
              <Stage height={160}>
                <Flex gap={12} align="center" wrap="wrap">
                  <Popover opened={opened()} onChange={setOpened} position={position()} offset={6} shadow="md">
                    <PopoverTarget>
                      <Button size="sm" variant="outline">Toggle · {position()}</Button>
                    </PopoverTarget>
                    <PopoverDropdown p="sm">
                      <Stack gap="xs">
                        <Text size="sm" fw={600}>Anchored dropdown</Text>
                        <Text size="xs" c="dimmed">position: {position()} · Escape and outside click close.</Text>
                      </Stack>
                    </PopoverDropdown>
                  </Popover>
                </Flex>
              </Stage>
              <Flex wrap="wrap" gap={8}>
                {positions.map((p) => (
                  <Button size="xs" variant={position() === p ? "filled" : "outline"} onClick={() => { setPosition(p); }}>
                    {p}
                  </Button>
                ))}
              </Flex>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const WidthAndShadow: Story = {
  render: () =>
    solidStory(() => {
      const [width, setWidth] = createSignal<number | string>(280);
      const [opened, setOpened] = createSignal(true);
      return (
        <Page>
          <Specimen title="Width and shadow" note="The dropdown width accepts a number (px) or any CSS width string.">
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                <Button size="xs" variant={width() === 280 ? "filled" : "outline"} onClick={() => setWidth(280)}>
                  width 280 (number → px)
                </Button>
                <Button size="xs" variant={width() === "min(420px, 80vw)" ? "filled" : "outline"} onClick={() => setWidth("min(420px, 80vw)")}>
                  width CSS string
                </Button>
                <Button size="xs" variant="outline" onClick={() => setOpened((v) => !v)}>
                  opened: {String(opened())}
                </Button>
              </Group>
              <Readout>resolved width: {String(width())}</Readout>
              <Stage height={200}>
                <Popover opened={opened()} onChange={setOpened} position="bottom-start" width={width()} shadow="lg" offset={8}>
                  <PopoverTarget>
                    <Button size="sm" variant="outline">Open settings</Button>
                  </PopoverTarget>
                  <PopoverDropdown p="sm">
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>Settings</Text>
                      <SampleRow label="Width" value={String(width())} />
                      <Box style={{ height: "48px", border: "1px solid var(--color-fin-border)", background: "var(--color-fin-surface-alt)" }} />
                    </Stack>
                  </PopoverDropdown>
                </Popover>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const FocusAndDismissal: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(true);
      const [lastClosedBy, setLastClosedBy] = createSignal("—");
      const close = (reason: string) => {
        setLastClosedBy(reason);
        setOpened(false);
      };
      return (
        <Page>
          <Specimen
            title="Focus and dismissal"
            note="Escape and an outside click both dismiss. trapFocus is passed as true here, but this primitive does not capture Tab."
          >
            <Stack gap="sm">
              <Readout>opened: {String(opened())} · last closed by: {lastClosedBy()}</Readout>
              <Stage height={200}>
                <Popover
                  opened={opened()}
                  onChange={(next) => {
                    if (!next) setLastClosedBy("onChange(false)");
                    setOpened(next);
                  }}
                  onClose={() => setLastClosedBy("onClose")}
                  position="bottom-start"
                  trapFocus
                  closeOnClickOutside
                >
                  <PopoverTarget>
                    <Button size="sm" variant="outline">Open dropdown</Button>
                  </PopoverTarget>
                  <PopoverDropdown p="sm">
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed">Tab from the target to reach this field — no trap is applied.</Text>
                      <input aria-label="Dropdown field" placeholder="Focus me with Tab" />
                      <Button size="xs" onClick={() => close("explicit button")}>Close explicitly</Button>
                    </Stack>
                  </PopoverDropdown>
                </Popover>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Playground: Story = {
  args: {
    position: "bottom",
    width: 300,
    offset: 6,
    shadow: "md",
    closeOnClickOutside: true,
    trapFocus: false,
  },
  render: (args) =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="Playground" code={`position="${String(args.position)}" · shadow="${String(args.shadow)}"`}>
              <Stage height={180}>
                <Popover
                  opened={opened()}
                  onChange={setOpened}
                  position={args.position}
                  width={args.width}
                  offset={Number(args.offset ?? 0)}
                  shadow={args.shadow}
                  closeOnClickOutside={Boolean(args.closeOnClickOutside)}
                  trapFocus={Boolean(args.trapFocus)}
                >
                  <PopoverTarget>
                    <Button size="sm" variant="outline">Toggle popover</Button>
                  </PopoverTarget>
                  <PopoverDropdown p="sm">
                    <SampleRow label="Controlled by" value="opened" />
                  </PopoverDropdown>
                </Popover>
              </Stage>
            </Specimen>
            <Specimen title="Open state" note="The same dropdown with opened fixed true for a stable capture.">
              <Stage height={180}>
                <Popover opened position="bottom-start" width={280} closeOnClickOutside={false}>
                  <PopoverTarget><Button size="sm" variant="outline">Frozen target</Button></PopoverTarget>
                  <PopoverDropdown p="sm">
                    <SampleRow label="Status" value="open" tone="var(--color-fin-primary)" />
                  </PopoverDropdown>
                </Popover>
              </Stage>
            </Specimen>
          </SpecimenGrid>
        </Page>
      );
    }),
};
