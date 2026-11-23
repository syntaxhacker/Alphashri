import type { Meta, StoryObj } from "@storybook/html-vite";
import { Loader, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const typeOptions = ["oval", "bars", "dots"];
const sizeOptions = ["xs", "sm", "md", "lg", "xl"] as const;
const colorOptions = ["primary", "success", "error", "danger", "warning", "info", "secondary", "default"];

const meta: Meta = {
  title: "Design System/Components/Feedback/Loader",
  tags: ["autodocs"],
  component: Loader as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Loader is an indeterminate activity indicator with `role=\"progressbar\"`, an accessible name and `aria-busy`. Its oval is a static track plus a rotating partial arc; bars and dots cross-fade. Every mark is scaled in percent, so xs never overflows. Motion is CSS-only and stops under `prefers-reduced-motion`.",
      },
    },
  },
  argTypes: {
    type: { control: { type: "select" }, options: typeOptions },
    size: { control: { type: "select" }, options: sizeOptions, description: "Named step; numeric px values are also accepted." },
    color: { control: { type: "select" }, options: colorOptions },
    className: { control: { type: "text" } },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { type: "oval", size: "md", color: "primary" },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Loader" note="Indeterminate activity: a track ring with a moving arc. Pick a type, size and semantic tone below.">
        <Section title="Playground" note="The labelled specimen reflects the controls in the panel above.">
          <Specimen label={`${args.type} · ${args.size} · ${args.color}`}>
            <Loader {...args} />
          </Specimen>
        </Section>
      </Catalog>
    )),
};

export const Types: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Loader — types" note="Three mark styles on one scale; all share currentColor and the same progressbar semantics.">
        <Section title="Oval, bars and dots" note="Oval spins a short arc over a static track; bars are three staggered columns; dots are three staggered circles.">
          <SpecimenGrid min={220}>
            {typeOptions.map((type) => (
              <Specimen label={type}>
                <Loader type={type} size="md" />
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
        <Section title="Small sizes stay intentional" note="Every type at xs / sm / md. Bar and dot marks are percentages of the host, so nothing clips at 16px.">
          <SpecimenGrid min={220}>
            {(["xs", "sm", "md"] as const).map((size) => (
              <Specimen label={`oval · ${size}`}>
                <Stack gap="sm" align="center" justify="center">
                  <Loader size={size} />
                  <Text size="xs" c="dimmed">{size}</Text>
                </Stack>
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};

export const SizesAndColors: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Loader — scale and tone" note="Three specimen rows: named sizes, a numeric size, and every documented semantic colour.">
        <Section title="Sizes" note="xs 16 · sm 20 · md 28 · lg 36 · xl 44px; a numeric size is treated as px.">
          <SpecimenGrid min={200}>
            {sizeOptions.map((size) => (
              <Specimen label={size}>
                <Loader size={size} />
              </Specimen>
            ))}
            <Specimen label="numeric 56">
              <Loader size={56} />
            </Specimen>
          </SpecimenGrid>
        </Section>
        <Section title="Semantic colours" note="Every documented color token, including the danger alias of error.">
          <SpecimenGrid min={200}>
            {colorOptions.map((color) => (
              <Specimen label={color}>
                <Loader color={color} />
              </Specimen>
            ))}
          </SpecimenGrid>
        </Section>
      </Catalog>
    )),
};
