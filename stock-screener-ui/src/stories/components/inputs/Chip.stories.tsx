import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Chip, Group, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { FIXTURE_LABEL, SECTORS } from "./fixtures";
import { Specimen, SpecimenCanvas } from "./specimen";

interface ChipArgs {
  label: string;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color: "primary" | "success" | "error" | "warning" | "info" | "secondary";
  variant: "filled" | "light" | "outline";
  disabled: boolean;
  checked: boolean;
}

const meta: Meta<ChipArgs> = {
  title: "Design System/Components/Inputs/Chip",
  component: Chip as unknown as Meta<ChipArgs>["component"],
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "src/ui/inputs/Chip.tsx — an interactive filter shaped as a 20px rounded rectangle (never a " +
          "capsule). Checked state adds a tone hairline plus a 12% wash; `variant=\"outline\"` keeps the " +
          "body transparent. It is a button with role=checkbox, so `label`/children are its visible name. " +
          "`onChange` receives the next boolean and works with a controlled `checked`.",
      },
    },
  },
  args: {
    label: "Large cap",
    size: "md",
    color: "primary",
    variant: "filled",
    disabled: false,
    checked: true,
  },
  argTypes: {
    label: { control: "text", description: "Visible chip text (children take precedence when provided)." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Height step: xs–md 20px, lg 22px, xl 24px.",
    },
    color: {
      control: "select",
      options: ["primary", "success", "error", "warning", "info", "secondary"],
      description: "Hairline, wash and text tone while checked.",
    },
    variant: {
      control: "select",
      options: ["filled", "light", "outline"],
      description: "Only outline changes the checked body: transparent instead of tinted.",
    },
    disabled: { control: "boolean", description: "Non-interactive, reduced opacity." },
    checked: { control: "boolean", description: "Controlled checked state." },
  },
};
export default meta;
type Story = StoryObj<ChipArgs>;

/** Controlled filter chip; the signal is the source of truth for aria-checked. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => {
      const [checked, setChecked] = createSignal(args.checked);
      return (
        <SpecimenCanvas>
          <Specimen title="Playground · Chip props" note={FIXTURE_LABEL} width={640}>
            <Stack gap="sm" style={{ "max-width": "360px" }}>
              <Group gap="sm" align="center" wrap="wrap">
                <Chip
                  label={args.label}
                  size={args.size}
                  color={args.color}
                  variant={args.variant}
                  disabled={args.disabled}
                  checked={checked()}
                  onChange={setChecked}
                />
              </Group>
              <Text size="xs" c="dimmed" aria-live="polite">{`Filter active: ${checked() ? "yes" : "no"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};

/** Height ladder; xs–md keep the 20px floor so a chip never reads as a badge. */
export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Height ladder" note="xs/sm/md 20 · lg 22 · xl 24 px — the 20px floor keeps chips distinct from badges.">
          <Group gap="md" align="center" wrap="wrap">
            <Chip size="xs" label="xs" defaultChecked />
            <Chip size="sm" label="sm" defaultChecked />
            <Chip size="md" label="md" defaultChecked />
            <Chip size="lg" label="lg" defaultChecked />
            <Chip size="xl" label="xl" defaultChecked />
          </Group>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** Checked tones and the outline treatment on the same set of filters. */
export const ColorsAndOutline: Story = {
  render: () =>
    solidStory(() => (
      <SpecimenCanvas>
        <Specimen title="Colours & outline" note="Named tones on checked chips, plus the transparent outline variant.">
          <Stack gap="lg">
            <Group gap="md" align="center" wrap="wrap">
              <Chip color="primary" label="Primary" defaultChecked />
              <Chip color="success" label="Success" defaultChecked />
              <Chip color="error" label="Error" defaultChecked />
              <Chip color="warning" label="Warning" defaultChecked />
              <Chip color="info" label="Info" defaultChecked />
              <Chip color="secondary" label="Secondary" defaultChecked />
            </Group>
            <Group gap="md" align="center" wrap="wrap">
              <Chip variant="outline" color="success" label="Confirmed" defaultChecked />
              <Chip variant="outline" color="error" label="Rejected" defaultChecked />
              <Chip variant="outline" label="Unchecked" />
            </Group>
          </Stack>
        </Specimen>
      </SpecimenCanvas>
    )),
};

/** A real filter row from the frozen sector set, including an unavailable option. */
export const FilterRowAndDisabled: Story = {
  render: () =>
    solidStory(() => {
      const [selected, setSelected] = createSignal<string[]>(["it", "banks"]);
      const toggle = (value: string, checked: boolean) =>
        setSelected((current) =>
          checked ? [...current, value] : current.filter((item) => item !== value),
        );
      return (
        <SpecimenCanvas>
          <Specimen title="Filter row" note="Labelled options from the frozen sector fixture, including one unavailable entry.">
            <Stack gap="sm">
              <Group gap="sm" align="center" wrap="wrap">
                {SECTORS.map((sector) => (
                  <Chip
                    label={sector.label}
                    disabled={sector.disabled}
                    checked={selected().includes(sector.value)}
                    onChange={(checked) => toggle(sector.value, checked)}
                  />
                ))}
              </Group>
              <Text size="xs" c="dimmed" aria-live="polite">{`Active: ${selected().join(", ") || "(none)"}`}</Text>
            </Stack>
          </Specimen>
        </SpecimenCanvas>
      );
    }),
};
