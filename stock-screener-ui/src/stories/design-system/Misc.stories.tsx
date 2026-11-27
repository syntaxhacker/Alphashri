import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import {
  Avatar, Badge, CloseButton, Flex, Group, Stack, Text, ThemeIcon,
} from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

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

const components: FamilyComponentRef[] = [
  { id: "design-system-components-misc-avatar--docs", name: "Avatar", note: "Initials, tone and size steps" },
  { id: "design-system-components-misc-closebutton--docs", name: "CloseButton", note: "Dismiss control in three sizes" },
  { id: "design-system-components-misc-themeicon--docs", name: "ThemeIcon", note: "Toned icon tile with variants" },
];

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
      <FamilyPage>
        <FamilyHero
          name="Misc"
          count={components.length}
          caption="panel chrome"
          purpose="The small finishing pieces that keep panels consistent: Avatar for an account or desk identity, ThemeIcon for a toned glyph tile and CloseButton for dismissal. They are deliberately quiet so they never compete with the data beside them."
          specimen={<PanelChromeSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="Avatars" note="Initials with tone and size steps; no image assets required.">
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
        </SpecimenPanel>
        <SpecimenPanel title="Theme icons and close buttons" note="Toned tiles and the three dismiss-control sizes.">
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
        </SpecimenPanel>
        <FamilyFooter source="src/ui" pages="src/stories/components/Misc" />
      </FamilyPage>
    )),
};
