import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Group, Text as MText, Title } from "@mantine/core";
import {
  PRIMARY,
  POSITIVE_COLOR,
  NEGATIVE_COLOR,
  TEXT_COLOR,
  TEXT_MUTED_COLOR,
  BG_COLOR,
  SURFACE_COLOR,
  BORDER_COLOR,
  SCALE_BLUE,
  SCALE_GREEN,
  SCALE_RED,
  SCALE_DARK,
} from "@/ui/palette";

const meta: Meta = {
  title: "Foundations/Colors",
  parameters: { layout: "padded", docs: { description: { component: "Semantic + scale colors from `src/ui/palette.ts` — the single source of truth. Never hardcode hex values in components; import semantic tokens (`POSITIVE`, `NEGATIVE`, `PRIMARY`) or use Mantine color names." } } },
};

export default meta;

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div style={{ width: 120 }}>
      <div style={{ height: 48, backgroundColor: hex, borderRadius: 6, border: "1px solid rgba(128,128,128,.3)" }} />
      <MText size="xs" fw={600} mt={4}>{name}</MText>
      <MText size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>{hex}</MText>
    </div>
  );
}

function Scale({ name, scale }: { name: string; scale: string[] }) {
  return (
    <div>
      <Title order={6} mb={6}>{name}</Title>
      <Group gap={4}>
        {scale.map((hex, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ width: 44, height: 36, backgroundColor: hex, borderRadius: 4, border: "1px solid rgba(128,128,128,.25)" }} />
            <MText size="10px" c="dimmed">{i}</MText>
          </div>
        ))}
      </Group>
    </div>
  );
}

export const SemanticTokens: StoryObj = {
  name: "Semantic Tokens",
  render: () => (
    <Stack gap="md">
      <Group gap="md">
        <Swatch name="PRIMARY" hex={PRIMARY} />
        <Swatch name="POSITIVE (up)" hex={POSITIVE_COLOR} />
        <Swatch name="NEGATIVE (down)" hex={NEGATIVE_COLOR} />
        <Swatch name="TEXT" hex={TEXT_COLOR} />
        <Swatch name="TEXT_MUTED" hex={TEXT_MUTED_COLOR} />
      </Group>
      <Group gap="md">
        <Swatch name="BG (body)" hex={BG_COLOR} />
        <Swatch name="SURFACE (cards)" hex={SURFACE_COLOR} />
        <Swatch name="BORDER" hex={BORDER_COLOR} />
      </Group>
    </Stack>
  ),
};

export const TradingColors: StoryObj = {
  name: "Trading Semantics",
  render: () => (
    <Group gap="lg">
      <Group gap={8}><div style={{ width: 14, height: 14, background: POSITIVE_COLOR, borderRadius: 3 }} /><MText size="sm">Gain / long / BUY</MText></Group>
      <Group gap={8}><div style={{ width: 14, height: 14, background: NEGATIVE_COLOR, borderRadius: 3 }} /><MText size="sm">Loss / short / SELL</MText></Group>
      <Group gap={8}><div style={{ width: 14, height: 14, background: PRIMARY, borderRadius: 3 }} /><MText size="sm">Interactive / accent</MText></Group>
    </Group>
  ),
};

export const ColorScales: StoryObj = {
  name: "Color Scales (0–9)",
  render: () => (
    <Stack gap="md">
      <Scale name="blue" scale={SCALE_BLUE} />
      <Scale name="green" scale={SCALE_GREEN} />
      <Scale name="red" scale={SCALE_RED} />
      <Scale name="dark (neutral surfaces)" scale={SCALE_DARK} />
    </Stack>
  ),
};
