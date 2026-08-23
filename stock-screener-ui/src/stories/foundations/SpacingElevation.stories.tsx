import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Group, Box as MBox, Text as MText, Title } from "@/ui";

const meta: Meta = {
  title: "Foundations/Spacing & Elevation",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Mantine spacing scale (1 = 0.25rem = 4px … xl = 2rem) and shadow levels. Pass spacing props (`p`, `gap`, `m`) as scale names or numbers — never arbitrary pixel strings.",
      },
    },
  },
};

export default meta;

const SPACING: Array<[string, string | number]> = [
  ["xs", "xs"], ["sm", "sm"], ["md", "md"], ["lg", "lg"], ["xl", "xl"],
];

export const SpacingScale: StoryObj = {
  render: () => (
    <Stack gap="xs">
      {SPACING.map(([name, val]) => (
        <Group key={name} gap="sm" align="center">
          <MText size="xs" w={40} fw={600}>{name}</MText>
          <MBox bg="blue.8" style={{ width: "var(--mantine-spacing-" + val + ")", height: 20, borderRadius: 3 }} />
          <MText size="xs" c="dimmed">var(--mantine-spacing-{val})</MText>
        </Group>
      ))}
    </Stack>
  ),
};

export const RadiusScale: StoryObj = {
  render: () => (
    <Group gap="md">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((r) => (
        <div key={r} style={{ textAlign: "center" }}>
          <MBox bg="blue.8" radius={r} style={{ width: 72, height: 48 }} />
          <MText size="xs" mt={4}>{r}</MText>
        </div>
      ))}
    </Group>
  ),
};

export const Elevation: StoryObj = {
  render: () => (
    <Stack gap="md">
      <Title order={6}>Shadow levels (Paper/Card `shadow` prop)</Title>
      <Group gap="xl">
        {(["xs", "sm", "md", "lg", "xl"] as const).map((sh) => (
          <div key={sh} style={{ textAlign: "center" }}>
            <MBox bg="var(--mantine-color-body)" shadow={sh} p="md" radius="md" style={{ border: "1px solid var(--mantine-color-default-border)" }}>
              <MText size="sm" fw={500}>shadow="{sh}"</MText>
            </MBox>
          </div>
        ))}
      </Group>
      <MText size="xs" c="dimmed">
        Cards in the app use sm/md; modals/popovers use lg/xl via Mantine defaults.
      </MText>
    </Stack>
  ),
};
