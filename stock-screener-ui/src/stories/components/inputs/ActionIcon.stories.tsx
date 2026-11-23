import type { Meta, StoryObj } from "@storybook/html-vite";
import { ActionIcon, Group, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas } from "./specimen";

interface ActionIconArgs {
  ariaLabel: string;
  variant: "filled" | "light" | "outline" | "subtle" | "default" | "transparent";
  color: "primary" | "success" | "error" | "warning" | "info" | "secondary";
  size: "xs" | "sm" | "md" | "lg" | "xl";
  radius: "xs" | "sm" | "md" | "lg" | "xl";
  disabled: boolean;
  loading: boolean;
}

const meta: Meta<ActionIconArgs> = {
  title: "Design System/Components/Inputs/ActionIcon",
  component: ActionIcon as unknown as Meta<ActionIconArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/ActionIcon.tsx — an icon-only control, not a small Button: a square on the " +
          "same height scale (xs 24 … xl 42) with no text padding and a raised-square hover. " +
          "Every instance needs an aria-label because it has no visible text. Numeric `size` sets an " +
          "explicit square via inline style; named sizes use the shared steps.",
      },
    },
  },
  args: {
    ariaLabel: "Refresh quotes",
    variant: "outline",
    color: "primary",
    size: "sm",
    radius: "md",
    disabled: false,
    loading: false,
  },
  argTypes: {
    ariaLabel: { control: "text", description: "Accessible name — the only label an icon-only control has." },
    variant: {
      control: "select",
      options: ["filled", "light", "outline", "subtle", "default", "transparent"],
      description: "Square treatment; default is the neutral toolbar icon.",
    },
    color: {
      control: "select",
      options: ["primary", "success", "error", "warning", "info", "secondary"],
      description: "Accent for fill, border and glyph together.",
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Named square step; a number is also accepted by the real component.",
    },
    radius: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Corner step; md (6px) is the control default.",
    },
    disabled: { control: "boolean", description: "Non-interactive, reduced opacity." },
    loading: { control: "boolean", description: "Replaces the glyph with a spinner and sets aria-busy." },
  },
};
export default meta;
type Story = StoryObj<ActionIconArgs>;

/** Controls-driven single icon action with a real accessible name. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Playground · ActionIcon props" note="Glyphs are aria-hidden; the control carries the accessible name." width={640}>
          <Stack gap="sm" style={{ "max-width": "320px" }}>
            <ActionIcon
              aria-label={args.ariaLabel}
              variant={args.variant}
              color={args.color}
              size={args.size}
              radius={args.radius}
              disabled={args.disabled}
              loading={args.loading}
            >
              <span aria-hidden="true">↻</span>
            </ActionIcon>
            <Text size="xs" c="dimmed">{`aria-label: ${args.ariaLabel} · size: ${args.size}`}</Text>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Square sizes match Button heights; xs is the dense-toolbar step. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Square sizes" note="Named steps 24 / 30 / 34 / 38 / 42 px, plus an explicit numeric square.">
          <Group gap="lg" align="center" wrap="wrap">
            <ActionIcon size="xs" aria-label="Refresh, extra small"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon size="sm" aria-label="Refresh, small"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon size="md" aria-label="Refresh, medium"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon size="lg" aria-label="Refresh, large"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon size="xl" aria-label="Refresh, extra large"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon size={28} aria-label="Refresh, fixed 28px"><span aria-hidden="true">↻</span></ActionIcon>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Neutral toolbar icons stay neutral; an explicit colour recolours the whole control. */
export const VariantsAndColors: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Treatments & colours" note="Treatments first, then semantic tones on the same treatment.">
          <Stack gap="lg">
            <Group gap="md" align="center" wrap="wrap">
              <ActionIcon variant="filled" aria-label="Filled add"><span aria-hidden="true">+</span></ActionIcon>
              <ActionIcon variant="light" aria-label="Light add"><span aria-hidden="true">+</span></ActionIcon>
              <ActionIcon variant="outline" aria-label="Outline add"><span aria-hidden="true">+</span></ActionIcon>
              <ActionIcon variant="subtle" aria-label="Subtle add"><span aria-hidden="true">+</span></ActionIcon>
              <ActionIcon variant="default" aria-label="Default add"><span aria-hidden="true">+</span></ActionIcon>
              <ActionIcon variant="transparent" aria-label="Transparent add"><span aria-hidden="true">+</span></ActionIcon>
            </Group>
            <Group gap="md" align="center" wrap="wrap">
              <ActionIcon variant="filled" color="success" aria-label="Confirm"><span aria-hidden="true">✓</span></ActionIcon>
              <ActionIcon variant="filled" color="error" aria-label="Reject"><span aria-hidden="true">×</span></ActionIcon>
              <ActionIcon variant="outline" color="warning" aria-label="Warnings"><span aria-hidden="true">!</span></ActionIcon>
              <ActionIcon variant="outline" color="info" aria-label="Information"><span aria-hidden="true">i</span></ActionIcon>
              <ActionIcon variant="outline" color="secondary" aria-label="Muted action"><span aria-hidden="true">·</span></ActionIcon>
            </Group>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Disabled and loading are native button states; each keeps its accessible name. */
export const DisabledAndLoading: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Disabled & loading" note="Loading swaps the glyph for a spinner and marks the button busy.">
          <Group gap="lg" align="center" wrap="wrap">
            <ActionIcon disabled aria-label="Disabled refresh"><span aria-hidden="true">↻</span></ActionIcon>
            <ActionIcon loading aria-label="Refreshing quotes" />
            <ActionIcon variant="light" color="primary" disabled aria-label="Disabled add"><span aria-hidden="true">+</span></ActionIcon>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};
