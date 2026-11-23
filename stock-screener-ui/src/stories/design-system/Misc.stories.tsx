import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Avatar, Badge, Card, CloseButton, Divider, Flex, Group, Paper, Stack, Text, ThemeIcon, Title,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Misc",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the small finishing pieces: Avatar, ThemeIcon and CloseButton. Each has its own page under Design System/Components/Misc; this page is an index plus two composed examples showing them in panel chrome.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const docsHref = (id: string) => `../?path=/docs/${id}`;
const DocsLink = (props: { id: string; label: string }) => (
  <Anchor href={docsHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

type ComponentRef = { id: string; name: string; note: string };
const components: ComponentRef[] = [
  { id: "design-system-components-misc-avatar--docs", name: "Avatar", note: "Initials, tone and size steps" },
  { id: "design-system-components-misc-closebutton--docs", name: "CloseButton", note: "Dismiss control in three sizes" },
  { id: "design-system-components-misc-themeicon--docs", name: "ThemeIcon", note: "Toned icon tile with variants" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component pages</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">At a glance · panel chrome</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open each card to reach its dedicated page.</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <DocsLink id={item.id} label={item.name} />
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

const Specimen = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

const PanelChromeSpecimen = () => (
  <Flex gap="md" align="center" wrap="wrap" style={{ "max-width": "720px", padding: "12px", background: palette.SURFACE_ALT, border: `1px solid ${palette.BORDER}` }}>
    <ThemeIcon color="primary">↻</ThemeIcon>
    <Stack gap="xs" style={{ "min-width": "220px", flex: 1 }}>
      <Text size="sm" fw={600}>Replay session</Text>
      <Text size="xs" c="dimmed">Icon, initials and dismiss control in one header row.</Text>
    </Stack>
    <Badge variant="light" color="success">READY</Badge>
    <Avatar color="primary">AS</Avatar>
    <CloseButton aria-label="Close replay session" />
  </Flex>
);

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Misc"
          count={components.length}
          purpose="The small finishing pieces that keep panels consistent: Avatar for an account or desk identity, ThemeIcon for a toned glyph tile and CloseButton for dismissal. They are deliberately quiet so they never compete with the data beside them."
          specimen={<PanelChromeSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Avatars" note="Initials with tone and size steps; no image assets required.">
          <Group gap="md" align="center" wrap="wrap">
            <Avatar>AS</Avatar>
            <Avatar color="primary">N</Avatar>
            <Avatar color="success">P</Avatar>
            <Avatar color="error">L</Avatar>
            <Avatar size="xs">xs</Avatar>
            <Avatar size="sm">sm</Avatar>
            <Avatar size="lg">lg</Avatar>
            <Avatar size={56}>56</Avatar>
          </Group>
        </Specimen>
        <Specimen title="Theme icons and close buttons" note="Toned tiles and the three dismiss-control sizes.">
          <Stack gap="md">
            <Group gap="md" align="center" wrap="wrap">
              <ThemeIcon color="primary">↻</ThemeIcon>
              <ThemeIcon color="success" variant="light">✓</ThemeIcon>
              <ThemeIcon color="warning" variant="outline">!</ThemeIcon>
              <ThemeIcon color="error" variant="filled">×</ThemeIcon>
              <ThemeIcon size="lg">Σ</ThemeIcon>
              <ThemeIcon size="xl" radius="xl">∞</ThemeIcon>
            </Group>
            <Group gap="sm" align="center" wrap="wrap">
              <CloseButton />
              <CloseButton size="sm" />
              <CloseButton size="lg" />
              <CloseButton variant="filled" />
              <CloseButton variant="outline" />
              <CloseButton disabled />
            </Group>
          </Stack>
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · per-component pages: <code>src/stories/components/Misc</code>.</Text>
      </Stack>
    )),
};
