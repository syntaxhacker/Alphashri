import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Divider } from "@mantine/core";
import { Text, Title, Code } from "@/ui";

const meta: Meta = {
  title: "Foundations/Typography",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Type scale from theme.tsx — sm/xs for meta, h1-h6 for headings, weights 400-800. App idiom: Text size=xs c=dimmed for labels. Mantine sizes map directly; use `Text`/`Title` from `@/ui`, never raw `<p>`/`<h*>`.",
      },
    },
  },
};

export default meta;

export const TypeScale: StoryObj = {
  render: () => (
    <Stack gap="sm">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => (
        <Text key={s} size={s}>
          size="{s}" — The quick brown fox jumps over the lazy dog 0123456789 ₹
        </Text>
      ))}
    </Stack>
  ),
};

export const Weights: StoryObj = {
  render: () => (
    <Stack gap={4}>
      {([400, 500, 600, 700, 800] as const).map((w) => (
        <Text key={w} size="sm" fw={w}>
          fw={"{" + w + "}"} — Reliance Industries Ltd
        </Text>
      ))}
    </Stack>
  ),
};

export const AppIdioms: StoryObj = {
  name: "App Idioms",
  render: () => (
    <Stack gap="md">
      <div>
        <Title order={6} mb={4}>Meta label (xs + dimmed) — 284 usages</Title>
        <Text size="xs" c="dimmed">Last updated 10:45:32 IST · NSE_EQ · 52W high ₹2,890.00</Text>
      </div>
      <Divider />
      <div>
        <Title order={6} mb={4}>Label → weighted value pair — canonical P&L row</Title>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">Unrealized P&L</Text>
          <Text size="sm" fw={600} c="green.6">+₹12,450.00 (+2.34%)</Text>
        </Stack>
        <Stack gap={2} mt="xs">
          <Text size="xs" c="dimmed">Quantity · Avg entry</Text>
          <Text size="sm" fw={500}>50 × ₹2,350.25</Text>
        </Stack>
      </div>
      <Divider />
      <div>
        <Title order={6} mb={4}>Monospace data (use Code)</Title>
        <Code>ORB 3745.00 / 3760.00 · R1 3780.00</Code>
      </div>
    </Stack>
  ),
};

export const HeadingScale: StoryObj = {
  render: () => (
    <Stack gap="xs">
      <Title order={1}>order=1 — Page title</Title>
      <Title order={2}>order=2 — Section</Title>
      <Title order={3}>order=3 — Panel header</Title>
      <Title order={4}>order=4</Title>
      <Title order={5}>order=5 — Card group label</Title>
      <Title order={6}>order=6 — Inline label</Title>
    </Stack>
  ),
};
