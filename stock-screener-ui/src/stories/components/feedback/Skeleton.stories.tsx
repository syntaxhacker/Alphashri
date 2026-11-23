import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { Box, Paper, Skeleton, Stack, Text } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section, Specimen, SpecimenGrid } from "./fixtures";

const radiusOptions = ["xs", "sm", "md", "lg", "xl"] as const;

const meta: Meta = {
  title: "Design System/Components/Feedback/Skeleton",
  tags: ["autodocs"],
  component: Skeleton as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Skeleton is an aria-hidden placeholder block. With no `w` it fills its host (default height 16px); the fill is the raised surface token with a CSS-only translucent shimmer that stops under `prefers-reduced-motion`. `visible=false` renders the real children instead. No text is ever drawn on the placeholder.",
      },
    },
  },
  argTypes: {
    h: { control: { type: "text" }, description: "Height in px (number) or any CSS length; defaults to 16px." },
    w: { control: { type: "text" }, description: "Width in px (number) or any CSS length; defaults to 100% of the host." },
    circle: { control: { type: "boolean" } },
    radius: { control: { type: "select" }, options: radiusOptions },
    animate: { control: { type: "boolean" }, description: "Adds the shimmer (on by default)." },
    visible: { control: { type: "boolean" }, description: "false renders children instead of the skeleton." },
  },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  args: { animate: true, visible: true },
  render: (args) =>
    solidStory(() => (
      <Catalog title="Skeleton" note="A content placeholder that inherits its host width. The shimmer is a transform-only CSS animation; reduced motion leaves a static raised-surface block.">
        <Section title="Playground" note="No explicit width: the bar fills the specimen from edge to edge.">
          <Paper p="sm" bg="var(--color-fin-surface)" radius="sm" style={{ border: "1px solid var(--color-fin-border)" }}>
            <Skeleton {...args} />
          </Paper>
        </Section>
      </Catalog>
    )),
};

export const Shapes: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Skeleton — shapes" note="Bars, avatars and radius steps, all painted in the raised surface token so they stay visible on a panel.">
        <Section title="Host fill and default height" note="Omitting w and h yields 100% × 16px. A wrapper supplies the concrete width.">
          <Stack gap="sm">
            <Box style={{ height: "16px" }}>
              <Skeleton animate />
            </Box>
            <Box style={{ height: "16px" }}>
              <Skeleton h={24} animate />
            </Box>
          </Stack>
        </Section>
        <Section title="Bars and circles" note="Numeric h/w become px; circle overrides the radius for avatar placeholders.">
          <Stack gap="sm">
            <Skeleton h={18} w="100%" animate />
            <Skeleton h={18} w="72%" animate />
            <Skeleton h={18} w="44%" animate />
          </Stack>
          <Box style={{ "padding-top": "16px" }}>
            <SpecimenGrid min={160}>
              <Specimen label="avatar 48px">
                <Skeleton circle h={48} w={48} animate />
              </Specimen>
              <Specimen label="surface 80px">
                <Skeleton h={64} w="80%" animate />
              </Specimen>
            </SpecimenGrid>
          </Box>
        </Section>
        <Section title="Static and radius steps" note="animate=false removes the shimmer; radius takes the shared token names.">
          <Stack gap="sm">
            <Skeleton h={24} w="100%" animate={false} />
            {radiusOptions.map((radius) => (
              <Stack gap="xs" style={{ "align-items": "center" }}>
                <Text size="xs" c="dimmed">{radius}</Text>
                <Box style={{ width: "100%" }}>
                  <Skeleton h={16} radius={radius} animate={false} />
                </Box>
              </Stack>
            ))}
          </Stack>
        </Section>
      </Catalog>
    )),
};

export const LoadingCard: Story = {
  render: () =>
    solidStory(() => (
      <Catalog title="Skeleton — composition" note="A realistic loading card and the visible switch, with the same palette tokens the app uses.">
        <Section title="Card placeholder" note="Avatar circle, two heading bars and three body lines on a surfaced panel.">
          <Paper p="md" bg="var(--color-fin-surface)" radius="sm" style={{ border: "1px solid var(--color-fin-border)" }}>
            <Stack gap="md">
              <Stack gap="sm" style={{ "flex-direction": "row", "align-items": "center" }}>
                <Skeleton circle h={48} w={48} animate />
                <Stack gap="sm" style={{ flex: 1 }}>
                  <Skeleton h={14} w="100%" animate />
                  <Skeleton h={10} w="60%" animate />
                </Stack>
              </Stack>
              <Stack gap="sm">
                <Skeleton h={10} w="100%" animate />
                <Skeleton h={10} w="92%" animate />
                <Skeleton h={10} w="70%" animate />
              </Stack>
            </Stack>
          </Paper>
        </Section>
        <Section title="Visible toggle" note="The labelled checkbox swaps the placeholder for the real content through the visible prop.">
          {(() => {
            const [visible, setVisible] = createSignal(true);
            return (
              <Stack gap="sm">
                <label style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
                  <input
                    type="checkbox"
                    checked={visible()}
                    aria-label="Show skeleton placeholder"
                    onChange={(event) => setVisible(event.currentTarget.checked)}
                  />
                  <Text size="xs">visible = {String(visible())}</Text>
                </label>
                <Paper p="sm" bg="var(--color-fin-surface)" radius="sm" style={{ border: "1px solid var(--color-fin-border)" }}>
                  <Skeleton visible={visible()} h={24}>
                    <Text size="sm">Real content revealed when visible is false.</Text>
                  </Skeleton>
                </Paper>
              </Stack>
            );
          })()}
        </Section>
      </Catalog>
    )),
};
