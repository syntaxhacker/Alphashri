import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Avatar, Badge, Group, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LabelledSample, Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

/**
 * Local image fixture: a data URI keeps the story offline. Palette tokens are
 * encoded into the SVG so the guard never sees a literal colour outside palette.ts.
 */
const avatarImage = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${palette.SURFACE_ALT}"/><circle cx="20" cy="15" r="7" fill="${palette.PRIMARY}"/><path d="M6 40a14 14 0 0 1 28 0" fill="${palette.PRIMARY}"/></svg>`,
)}`;

const meta: Meta = {
  title: "Design System/Components/Misc/Avatar",
  tags: ["autodocs"],
  component: Avatar as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Avatar is a circular-by-default image or initials badge. `size` takes xs/sm/md/lg/xl or a number (default 40px), `color` picks a semantic fill, and `radius` switches the corner treatment. With no `src` the label comes from `children`, else from `alt` initialised to the first letter of up to two words, else a question mark. Setting `src` always renders an `<img>` — there is no load-error fallback in the component, so the InitialsAndFallback story shows the real fallback path (absent or null src) alongside a local data-URI image.",
      },
    },
  },
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl", 56],
      description: "Preset size or numeric px; presets are xs 24 · sm 32 · md 40 · lg 48 · xl 56.",
    },
    color: {
      control: "select",
      options: ["primary", "secondary", "success", "error", "warning", "info", "danger"],
      description: "Semantic fill. Unset uses the neutral surface with text ink.",
    },
    radius: { control: "select", options: ["xs", "sm", "md", "lg", "xl"], description: "Corner treatment." },
    src: { control: "text", description: "Image URL or data URI. When set, an <img> replaces the label." },
    alt: { control: "text", description: "Image alt text; without children it also supplies the initials." },
    children: { control: "text", description: "Explicit label; overrides alt-derived initials." },
  },
  args: { size: "md", color: "primary", alt: "Ada Lovelace" },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Playground"
          code={`size="${String(args.size)}" · color="${String(args.color)}" · radius="${String(args.radius)}"`}
        >
          <Stack gap="sm" align="flex-start">
            <Readout>alt: {String(args.alt ?? "Avatar")} · src: {args.src ? "local data URI" : "none"}</Readout>
            <Avatar
              size={args.size}
              color={args.color}
              radius={args.radius}
              src={args.src ?? null}
              alt={args.alt ?? "Avatar"}
            >
              {args.children ?? undefined}
            </Avatar>
          </Stack>
        </Specimen>
      </Page>
    )),
};

export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Sizes" note="Preset sizes map to 24 / 32 / 40 / 48 / 56px. A numeric size is used verbatim as px.">
          <Group gap="sm" align="flex-start" wrap="wrap">
            <LabelledSample label="xs · 24"><Avatar size="xs" color="primary" alt="xs">xs</Avatar></LabelledSample>
            <LabelledSample label="sm · 32"><Avatar size="sm" color="primary" alt="sm">sm</Avatar></LabelledSample>
            <LabelledSample label="md · 40"><Avatar size="md" color="primary" alt="md">md</Avatar></LabelledSample>
            <LabelledSample label="lg · 48"><Avatar size="lg" color="primary" alt="lg">lg</Avatar></LabelledSample>
            <LabelledSample label="xl · 56"><Avatar size="xl" color="primary" alt="xl">xl</Avatar></LabelledSample>
            <LabelledSample label="56 · numeric"><Avatar size={56} color="primary" alt="56">56</Avatar></LabelledSample>
          </Group>
        </Specimen>
      </Page>
    )),
};

export const Colors: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Semantic colours" note="Each fill maps to one semantic role; without color, Avatar uses the neutral surface.">
          <Group gap="sm" align="flex-start" wrap="wrap">
            <LabelledSample label="primary"><Avatar color="primary" alt="PR">PR</Avatar></LabelledSample>
            <LabelledSample label="secondary"><Avatar color="secondary" alt="SE">SE</Avatar></LabelledSample>
            <LabelledSample label="success"><Avatar color="success" alt="SU">SU</Avatar></LabelledSample>
            <LabelledSample label="error"><Avatar color="error" alt="ER">ER</Avatar></LabelledSample>
            <LabelledSample label="warning"><Avatar color="warning" alt="WA">WA</Avatar></LabelledSample>
            <LabelledSample label="info"><Avatar color="info" alt="IN">IN</Avatar></LabelledSample>
            <LabelledSample label="danger"><Avatar color="danger" alt="DA">DA</Avatar></LabelledSample>
            <LabelledSample label="neutral"><Avatar alt="NE">NE</Avatar></LabelledSample>
          </Group>
        </Specimen>
      </Page>
    )),
};

export const InitialsAndFallback: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="alt-derived initials" note="No children: the first letter of up to two alt words is used.">
            <Group gap="sm" align="flex-start" wrap="wrap">
              <LabelledSample label="Ada Lovelace"><Avatar alt="Ada Lovelace" /></LabelledSample>
              <LabelledSample label="Nifty Fifty"><Avatar alt="Nifty Fifty" color="success" /></LabelledSample>
              <LabelledSample label="Single"><Avatar alt="Single" color="info" /></LabelledSample>
            </Group>
          </Specimen>
          <Specimen title="explicit children" note="children wins over alt-derived initials.">
            <Group gap="sm" align="flex-start" wrap="wrap">
              <LabelledSample label="AS"><Avatar color="warning">AS</Avatar></LabelledSample>
              <LabelledSample label="!"><Avatar color="error" radius="xs">!</Avatar></LabelledSample>
              <LabelledSample label="∞"><Avatar color="primary" radius="xl">∞</Avatar></LabelledSample>
            </Group>
          </Specimen>
          <Specimen title="image and fallback" note="src renders an <img> from a local data URI; null or absent src takes the label path.">
            <Group gap="sm" align="flex-start" wrap="wrap">
              <LabelledSample label="src set"><Avatar src={avatarImage} alt="Local avatar" /></LabelledSample>
              <LabelledSample label="src null"><Avatar src={null} alt="Local avatar" /></LabelledSample>
              <LabelledSample label="no src"><Avatar alt="Local avatar" /></LabelledSample>
              <LabelledSample label="large"><Avatar src={avatarImage} alt="Sized avatar" size="lg" /></LabelledSample>
            </Group>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="User rows" note="Avatar sits alongside Text and Badge using the same layout primitives as the app.">
          <Stack gap="sm">
            <Group
              gap="sm"
              align="center"
              style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface-alt)", padding: "8px" }}
            >
              <Avatar src={avatarImage} alt="Ada Lovelace" size="sm" />
              <Stack gap="0" style={{ flex: 1, "min-width": 0 }}>
                <Text size="sm" fw={600}>Ada Lovelace</Text>
                <Text size="xs" c="dimmed">Paper trading · session pinned</Text>
              </Stack>
              <Badge size="xs" color="success">online</Badge>
            </Group>
            <Group
              gap="sm"
              align="center"
              style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface-alt)", padding: "8px" }}
            >
              <Avatar alt="Grace Hopper" size="sm" color="info" />
              <Stack gap="0" style={{ flex: 1, "min-width": 0 }}>
                <Text size="sm" fw={600}>Grace Hopper</Text>
                <Text size="xs" c="dimmed">Initials fallback when no image is set</Text>
              </Stack>
              <Badge size="xs" color="warning">idle</Badge>
            </Group>
            <SampleRow label="Workspace members" value="2 online" />
          </Stack>
        </Specimen>
      </Page>
    )),
};
