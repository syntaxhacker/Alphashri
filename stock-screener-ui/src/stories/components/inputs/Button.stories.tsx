import type { Meta, StoryObj } from "@storybook/html-vite";
import { Button, Group, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Specimen, SpecimenCanvas, SpecimenGrid } from "./specimen";

interface ButtonArgs {
  children: string;
  variant: "filled" | "light" | "outline" | "subtle" | "default" | "transparent" | "white";
  color: "primary" | "success" | "error" | "warning" | "info" | "secondary";
  size: "xs" | "sm" | "md" | "lg" | "xl";
  radius: "xs" | "sm" | "md" | "lg" | "xl";
  fullWidth: boolean;
  disabled: boolean;
  loading: boolean;
}

const meta: Meta<ButtonArgs> = {
  title: "Design System/Components/Inputs/Button",
  component: Button as unknown as Meta<ButtonArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Button.tsx — five distinct treatments (filled, light, outline, subtle, default) " +
          "plus white and text-only transparent. `size` owns height on one shared scale (xs 24, sm 30, " +
          "md 34, lg 38, xl 42); `color` recolours the whole treatment. `loading` disables the control " +
          "and swaps in a spinner. All tones are CSS variables from the single palette source.",
      },
    },
  },
  args: {
    children: "Place order",
    variant: "filled",
    color: "primary",
    size: "sm",
    radius: "md",
    fullWidth: false,
    disabled: false,
    loading: false,
  },
  argTypes: {
    children: { control: "text", description: "Visible button label." },
    variant: {
      control: "select",
      options: ["filled", "light", "outline", "subtle", "default", "transparent", "white"],
      description: "Treatment of the box: solid, wash, hairline, ghost, form button or text-only.",
    },
    color: {
      control: "select",
      options: ["primary", "success", "error", "warning", "info", "secondary"],
      description: "Accent applied to fill, border and text together; only an explicit colour tints the control.",
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Height/type step shared with ActionIcon.",
    },
    radius: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Corner step; md (6px) is the control default.",
    },
    fullWidth: { control: "boolean", description: "Stretch to the container width." },
    disabled: { control: "boolean", description: "Non-interactive, reduced opacity." },
    loading: { control: "boolean", description: "Spinner in the left slot, aria-busy and native disabled." },
  },
};
export default meta;
type Story = StoryObj<ButtonArgs>;

/** Controls-driven single button: every arg above maps to a real Button prop. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Playground · Button props" note="Live controls; every arg maps to a real Button prop, with no local wrapper component." width={640}>
          <Stack gap="sm" style={{ width: "360px", "max-width": "100%" }}>
            <Button
              variant={args.variant}
              color={args.color}
              size={args.size}
              radius={args.radius}
              fullWidth={args.fullWidth}
              disabled={args.disabled}
              loading={args.loading}
            >
              {args.children}
            </Button>
            <Text size="xs" c="dimmed">{`variant: ${args.variant} · colour: ${args.color} · size: ${args.size}`}</Text>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Treatment is the primary axis: solid / wash / hairline / ghost / form button. */
export const Variants: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Treatments" note="Five treatments at the same size, plus white and transparent.">
          <Group gap="md" align="center" wrap="wrap">
            <Button variant="filled">Filled</Button>
            <Button variant="light">Light</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="default">Default</Button>
            <Button variant="white">White</Button>
            <Button variant="transparent">Transparent</Button>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** One step per size; no variant changes height at a given step. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height scale" note="xs 24 · sm 30 · md 34 · lg 38 · xl 42 px — the same steps for every treatment.">
          <Group gap="md" align="center" wrap="wrap">
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
            <Button size="xl">xl</Button>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Semantics use named tones; the amber default keeps neutral toolbars neutral. */
export const Colors: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Semantic colours" note="Named tones on a filled button and on the outline treatment.">
          <Stack gap="lg">
            <Group gap="md" align="center" wrap="wrap">
              <Button color="primary">Primary</Button>
              <Button color="success">Success</Button>
              <Button color="error">Error</Button>
              <Button color="warning">Warning</Button>
              <Button color="info">Info</Button>
              <Button color="secondary">Secondary</Button>
            </Group>
            <Group gap="md" align="center" wrap="wrap">
              <Button variant="outline" color="success">Confirm</Button>
              <Button variant="outline" color="error">Cancel order</Button>
              <Button variant="outline" color="warning">Review</Button>
            </Group>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Disabled and loading are native disabled states; sections flank the label. */
export const DisabledLoadingAndSections: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Disabled, loading and sections" note="Loading sets aria-busy and disables clicks; sections keep their own slot.">
          <Group gap="md" align="center" wrap="wrap">
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <Button leftSection={<span aria-hidden="true">⌕</span>}>With left section</Button>
            <Button rightSection={<span aria-hidden="true">→</span>} variant="light">With right section</Button>
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Edge states: full-width form button and the radius ladder. */
export const WidthAndRadius: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Width & radius" note="fullWidth stretches to the cell; radius xs → xl changes only the corners.">
          <SpecimenGrid cols={2}>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">Form action</Text>
              <Button variant="default" fullWidth>Full-width form button</Button>
            </Stack>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">Corner ladder</Text>
              <Group gap="sm" align="center" wrap="wrap">
                <Button radius="xs" size="xs">xs</Button>
                <Button radius="sm" size="xs">sm</Button>
                <Button radius="md" size="xs">md</Button>
                <Button radius="lg" size="xs">lg</Button>
                <Button radius="xl" size="xs">xl</Button>
              </Group>
            </Stack>
          </SpecimenGrid>
        </Specimen>
      </SpecimenCanvas>
    )),
};
