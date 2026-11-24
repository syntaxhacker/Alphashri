import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import { Badge, Group, Stack, Text, ThemeIcon } from "@/ui";
import { IconActivity, IconAlertCircle, IconBolt, IconRefresh } from "@/ui/icons";
import { LabelledSample, Page, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Misc/ThemeIcon",
  tags: ["autodocs"],
  component: ThemeIcon as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "ThemeIcon is a fixed-square glyph wrapper for inline SVG icons. `size` accepts xs/sm/md/lg/xl (20 / 28 / 36 / 48 / 56px) or a numeric px value; `radius` accepts xs (4px), xl (16px) or a number (6px default). `color` is looked up in sxTheme.palette, so semantic names resolve to the shared anchors. `variant` picks filled (solid contrast fill), light (the default subtle fill), outline, default or white (both use the paper background).",
      },
    },
  },
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl", 44],
      description: "Preset size or numeric px; presets are xs 20 · sm 28 · md 36 · lg 48 · xl 56.",
    },
    color: {
      control: "select",
      options: ["primary", "secondary", "success", "error", "warning", "info"],
      description: "Resolved from sxTheme.palette; a literal colour string is also accepted.",
    },
    variant: {
      control: "select",
      options: ["light", "filled", "outline", "default", "white"],
      description: "light is the default tinted fill; outline keeps a transparent background.",
    },
    radius: { control: "select", options: ["xs", "md", "lg", "xl"], description: "Corner treatment in px." },
    children: { control: "text", description: "Glyph or icon element rendered inside." },
  },
  args: { size: "md", color: "primary", variant: "light", radius: "md" },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Playground"
          code={`size="${String(args.size)}" · variant="${String(args.variant)}" · color="${String(args.color)}"`}
        >
          <Stack gap="sm" align="flex-start">
            <Text size="xs" c="dimmed" className="font-mono">Icon badge · {String(args.radius)} corners</Text>
            <ThemeIcon size={args.size} color={args.color} variant={args.variant} radius={args.radius}>
              {args.children ?? "★"}
            </ThemeIcon>
          </Stack>
        </Specimen>
      </Page>
    )),
};

export const Sizes: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Sizes" note="Preset sizes map to 20 / 28 / 36 / 48 / 56px; numeric sizes pass through as px.">
          <Group gap="sm" align="flex-start" wrap="wrap">
            <LabelledSample label="xs · 20"><ThemeIcon size="xs" color="primary" aria-label="Extra small icon">x</ThemeIcon></LabelledSample>
            <LabelledSample label="sm · 28"><ThemeIcon size="sm" color="primary" aria-label="Small icon">s</ThemeIcon></LabelledSample>
            <LabelledSample label="md · 36"><ThemeIcon size="md" color="primary" aria-label="Medium icon">m</ThemeIcon></LabelledSample>
            <LabelledSample label="lg · 48"><ThemeIcon size="lg" color="primary" aria-label="Large icon">l</ThemeIcon></LabelledSample>
            <LabelledSample label="xl · 56"><ThemeIcon size="xl" color="primary" aria-label="Extra large icon">x</ThemeIcon></LabelledSample>
            <LabelledSample label="44 · numeric"><ThemeIcon size={44} color="primary" aria-label="Numeric size icon">44</ThemeIcon></LabelledSample>
          </Group>
        </Specimen>
      </Page>
    )),
};

export const Colors: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="Light (default)" note="The default fill is the palette hue at its subtle tint.">
            <Group gap="sm" align="flex-start" wrap="wrap">
              <LabelledSample label="primary"><ThemeIcon color="primary" aria-label="Primary light"><IconBolt size={16} /></ThemeIcon></LabelledSample>
              <LabelledSample label="secondary"><ThemeIcon color="secondary" aria-label="Secondary light"><IconActivity size={16} /></ThemeIcon></LabelledSample>
              <LabelledSample label="success"><ThemeIcon color="success" aria-label="Success light">✓</ThemeIcon></LabelledSample>
              <LabelledSample label="error"><ThemeIcon color="error" aria-label="Error light">×</ThemeIcon></LabelledSample>
              <LabelledSample label="warning"><ThemeIcon color="warning" aria-label="Warning light">!</ThemeIcon></LabelledSample>
              <LabelledSample label="info"><ThemeIcon color="info" aria-label="Info light">i</ThemeIcon></LabelledSample>
            </Group>
          </Specimen>
          <Specimen title="Filled" note="filled uses the palette contrast text as a solid background.">
            <Group gap="sm" align="flex-start" wrap="wrap">
              <LabelledSample label="primary"><ThemeIcon variant="filled" color="primary" aria-label="Primary filled"><IconRefresh size={16} /></ThemeIcon></LabelledSample>
              <LabelledSample label="success"><ThemeIcon variant="filled" color="success" aria-label="Success filled">✓</ThemeIcon></LabelledSample>
              <LabelledSample label="error"><ThemeIcon variant="filled" color="error" aria-label="Error filled">×</ThemeIcon></LabelledSample>
              <LabelledSample label="warning"><ThemeIcon variant="filled" color="warning" aria-label="Warning filled">!</ThemeIcon></LabelledSample>
              <LabelledSample label="info"><ThemeIcon variant="filled" color="info" aria-label="Info filled">i</ThemeIcon></LabelledSample>
            </Group>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Variants: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          {(["light", "filled", "outline", "default", "white"] as const).map((variant) => (
            <Specimen title="Variant" code={`variant="${variant}"`}>
              <LabelledSample label={variant}>
                <ThemeIcon variant={variant} color="primary" aria-label={`${variant} theme icon`}><IconBolt size={16} /></ThemeIcon>
              </LabelledSample>
            </Specimen>
          ))}
        </SpecimenGrid>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Status rows" note="ThemeIcon carries the glyph; the label and Badge carry the meaning.">
          <Stack gap="sm">
            <Group
              gap="sm"
              align="center"
              style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface-alt)", padding: "8px" }}
            >
              <ThemeIcon size="sm" variant="light" color="success" aria-label="Feed healthy"><IconActivity size={14} /></ThemeIcon>
              <Text size="sm" style={{ flex: 1, "min-width": 0 }}>Market data feed</Text>
              <Badge size="xs" color="success">live</Badge>
            </Group>
            <Group
              gap="sm"
              align="center"
              style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface-alt)", padding: "8px" }}
            >
              <ThemeIcon size="sm" variant="filled" color="warning" aria-label="Risk warning"><IconAlertCircle size={14} /></ThemeIcon>
              <Text size="sm" style={{ flex: 1, "min-width": 0 }}>Exposure cap near limit</Text>
              <Badge size="xs" color="warning">review</Badge>
            </Group>
            <Group
              gap="sm"
              align="center"
              style={{ border: "1px solid var(--color-fin-border)", "border-radius": "4px", background: "var(--color-fin-surface-alt)", padding: "8px" }}
            >
              <ThemeIcon size="sm" variant="outline" color="info" radius="xl" aria-label="Refresh in progress"><IconRefresh size={14} /></ThemeIcon>
              <Text size="sm" style={{ flex: 1, "min-width": 0 }}>Snapshot refresh</Text>
              <Badge size="xs" color="info">queued</Badge>
            </Group>
            <SampleRow label="Last check" value="frame pinned" />
          </Stack>
        </Specimen>
      </Page>
    )),
};
