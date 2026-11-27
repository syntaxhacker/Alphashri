import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Flex, Group, Stack, Text, Tooltip } from "@/ui";
import type { UITooltipProps } from "@/ui";
import * as palette from "@/ui/palette";
import { Page, Specimen, SpecimenGrid, Stage } from "./fixtures";

const positions = [
  "top", "top-start", "top-end",
  "bottom", "bottom-start", "bottom-end",
  "left", "left-start", "left-end",
  "right", "right-start", "right-end",
] as const satisfies readonly NonNullable<UITooltipProps["position"]>[];

const meta: Meta = {
  title: "Design System/Components/Overlay/Tooltip",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: Tooltip as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Tooltip wraps a trigger and shows a portalled, viewport-flipped label on hover. `position` requests a side (top/bottom/left/right plus -start/-end); the primitive flips to the opposite side when the viewport lacks room. `openDelay` / `closeDelay` schedule the show/hide, `disabled` renders only the child, and `multiline` wraps long labels. It is hover-only — there is no focus trigger in this primitive, so keyboard users do not open it.",
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "Tooltip content; a string also becomes the wrapper's aria-label." },
    position: { control: "select", options: [...positions], description: "Requested side; flips when there is no room." },
    openDelay: { control: { type: "number", min: 0, step: 50 }, description: "Hover-to-open delay in ms (default 0)." },
    closeDelay: { control: { type: "number", min: 0, step: 50 }, description: "Leave-to-close delay in ms (default 0)." },
    disabled: { control: "boolean", description: "Render the child with no tooltip behaviour." },
    multiline: { control: "boolean", description: "Wrap the label instead of nowrap." },
    withArrow: { control: "boolean", description: "Draw an arrow on the floating box." },
    color: { control: "text", description: "Background colour token (e.g. a palette value); white text is applied." },
  },
};
export default meta;
type Story = StoryObj;

/**
 * Tooltip is hover-only and portalled, so a screenshot cannot hold it open.
 * This is the same chrome rendered in flow for a stable open-state specimen.
 */
function FrozenTooltip(props: { label: string; note?: string; width?: number }) {
  return (
    <Group gap="sm" align="center" wrap="wrap">
      <Button size="xs" variant="outline">Flow read</Button>
      <Box
        role="tooltip"
        style={{
          padding: "6px 10px",
          border: "1px solid var(--color-fin-border)",
          "border-radius": "4px",
          background: "var(--color-fin-surface-alt)",
          color: "var(--color-fin-text)",
          "max-width": props.width ? `${props.width}px` : undefined,
        }}
      >
        <Stack gap="xs">
          <Text size="xs">{props.label}</Text>
          {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
        </Stack>
      </Box>
    </Group>
  );
}

export const OpenTooltip: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="Open tooltip" code='position="top"' note="Frozen label beside its trigger; the live component below opens on hover.">
            <Stage height={132}>
              <FrozenTooltip label="5-minute flow is constructive" note="Open interest builds on the call wall." />
            </Stage>
          </Specimen>
          <Specimen title="Multiline tooltip" code="multiline" note="Long copy wraps at 280px in the real component.">
            <Stage height={132}>
              <FrozenTooltip
                width={280}
                label="Open interest builds on the call wall while spot holds above the put wall."
                note="Five-minute flow read stays constructive into expiry."
              />
            </Stage>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Positions: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Positions" note="All twelve accepted positions. Each flips to the opposite side if it would leave the viewport.">
          <Stage height={188}>
            <Flex wrap="wrap" gap={20}>
              {positions.map((position) => (
                <Tooltip label={`position: ${position}`} position={position} withArrow>
                  <Button size="xs" variant="outline">{position}</Button>
                </Tooltip>
              ))}
            </Flex>
          </Stage>
        </Specimen>
      </Page>
    )),
};

export const Delays: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Delays" note="Hover each target. openDelay defers showing; closeDelay keeps the label briefly after leave.">
          <Stage height={132}>
            <Flex gap={20} align="center" wrap="wrap">
              <Tooltip label="Immediate (0 / 0)" withArrow>
                <Button size="xs" variant="outline">0 / 0</Button>
              </Tooltip>
              <Tooltip label="Slow to appear (500 / 0)" openDelay={500} withArrow>
                <Button size="xs" variant="outline">openDelay 500</Button>
              </Tooltip>
              <Tooltip label="Lingers on leave (0 / 600)" closeDelay={600} withArrow>
                <Button size="xs" variant="outline">closeDelay 600</Button>
              </Tooltip>
              <Tooltip label="Both (400 / 400)" openDelay={400} closeDelay={400} withArrow>
                <Button size="xs" variant="outline">400 / 400</Button>
              </Tooltip>
            </Flex>
          </Stage>
        </Specimen>
      </Page>
    )),
};

export const DisabledAndMultiline: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Disabled, multiline and colour" note="disabled renders only the child; color swaps in a palette token with white text.">
          <Stack gap="sm">
            <Stage height={132}>
              <Flex gap={20} align="center" wrap="wrap">
                <Tooltip label="This tooltip is disabled" disabled>
                  <Button size="xs" variant="outline">Disabled · no hover</Button>
                </Tooltip>
                <Tooltip
                  label="Open interest builds on the call wall while spot holds above the put wall, so the five-minute flow read stays constructive into expiry."
                  multiline
                  withArrow
                >
                  <Button size="xs" variant="outline">Multiline</Button>
                </Tooltip>
                <Tooltip label="Palette token as background" color={palette.INFO} withArrow>
                  <Button size="xs" variant="outline">Colour · info token</Button>
                </Tooltip>
              </Flex>
            </Stage>
            <SpecimenGrid>
              <Box>
                <Text size="xs" fw={700} c="primary" className="font-mono">frozen disabled state</Text>
                <Text size="xs" c="dimmed">No handlers are attached, so nothing appears on hover.</Text>
              </Box>
              <Box>
                <Text size="xs" fw={700} c="primary" className="font-mono">frozen multiline state</Text>
                <FrozenTooltip width={280} label="Open interest builds on the call wall while spot holds above the put wall." />
              </Box>
            </SpecimenGrid>
          </Stack>
        </Specimen>
      </Page>
    )),
};

export const Playground: Story = {
  args: {
    label: "Hover the target",
    position: "bottom",
    openDelay: 0,
    closeDelay: 0,
    disabled: false,
    multiline: false,
    withArrow: true,
  },
  render: (args) =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="Playground" code={`position="${String(args.position)}" · disabled=${String(args.disabled)}`}>
            <Stage height={132}>
              <Tooltip
                label={String(args.label ?? "Tooltip")}
                position={args.position}
                openDelay={Number(args.openDelay ?? 0)}
                closeDelay={Number(args.closeDelay ?? 0)}
                disabled={Boolean(args.disabled)}
                multiline={Boolean(args.multiline)}
                withArrow={Boolean(args.withArrow)}
              >
                <Button size="xs" variant="outline">Hover target</Button>
              </Tooltip>
            </Stage>
          </Specimen>
          <Specimen title="Frozen label" note="The label the live tooltip shows while it is open.">
            <Stage height={132}>
              <FrozenTooltip label={String(args.label ?? "Tooltip")} />
            </Stage>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};
