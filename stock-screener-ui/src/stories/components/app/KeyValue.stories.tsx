import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { Box, Group, Paper, SimpleGrid, Stack, Text } from "@/ui";
import {
  Delta,
  KeyValue,
  KeyValueGrid,
  KeyValuePair,
  type KeyValueTone,
} from "@/components/common/KeyValue";
import { solidStory } from "@/stories/solidStory";
import { Specimen } from "./StoryFrame";

const FIXTURE_LABEL = "frozen NIFTY quote · 2026-11-20 09:15 IST";
const SPOT = "23,450.85";
const CHANGE = "+18.42 (0.08%)";

const PANEL_MAX = 880;
/** Below this cell width a nowrap figure would be clipped by the panel's overflow. */
const GRID_MIN = 240;

/**
 * StoryFrame's DemoPanel pins width to 880px, which widened the 390 capture to
 * 900px (20px host padding + 880px panel). This frame keeps the same surface
 * but flexes down with the viewport, so every figure stays inside the panel.
 */
function KVFrame(props: { children: JSX.Element }): JSX.Element {
  return (
    <Stack
      gap="md"
      style={{ width: "100%", "max-width": `${PANEL_MAX}px`, "min-width": 0, margin: "0 auto" }}
    >
      {props.children}
    </Stack>
  );
}

function KVPanel(props: {
  title: string;
  detail?: string;
  meta?: string;
  testId?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Paper
      component="section"
      w="100%"
      maw={PANEL_MAX}
      radius={6}
      testId={props.testId}
      style={{
        border: "1px solid var(--color-fin-border)",
        "background-color": "var(--color-fin-surface)",
        overflow: "hidden",
        "box-sizing": "border-box",
      }}
    >
      <Stack
        gap="xs"
        style={{
          padding: "12px 16px",
          "background-color": "var(--color-fin-surface-alt)",
          "border-bottom": "1px solid var(--color-fin-border)",
        }}
      >
        <Group justify="space-between" align="center" gap="md" wrap="wrap">
          <Text size="sm" fw={700} c="default">{props.title}</Text>
          <Show when={props.meta}>
            <Text size="xs" c="secondary" style={{ "font-variant-numeric": "tabular-nums" }}>
              {props.meta}
            </Text>
          </Show>
        </Group>
        <Show when={props.detail}>
          <Text size="xs" c="secondary">{props.detail}</Text>
        </Show>
      </Stack>
      <Box style={{ padding: "16px", "min-width": 0 }}>{props.children}</Box>
    </Paper>
  );
}

/** Auto-fit cells so two-up specimens stack before their nowrap values clip. */
function KVSpecimenGrid(props: { children: JSX.Element }): JSX.Element {
  return (
    <SimpleGrid
      spacing="md"
      style={{ "grid-template-columns": `repeat(auto-fit, minmax(min(100%, ${GRID_MIN}px), 1fr))` }}
    >
      {props.children}
    </SimpleGrid>
  );
}

type KeyValueArgs = {
  label: string;
  value: string;
  hint: string;
  tone: KeyValueTone;
  align: "left" | "right";
  mono: boolean;
  dense: boolean;
  testId: string;
};

const meta: Meta<KeyValueArgs> = {
  title: "Design System/Components/App/KeyValue",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Semantic label/value primitives from src/components/common/KeyValue.tsx. " +
          "`KeyValue` renders a `<dl>` so the pairing survives screen readers; `Delta` is a " +
          "grouped, aria-labelled phrase; `KeyValuePair` composes the two; `KeyValueGrid` lays " +
          "them out. Numeric rows default to right alignment and tabular figures.",
      },
    },
  },
  args: {
    label: "Spot",
    value: SPOT,
    hint: CHANGE,
    tone: "success",
    align: "right",
    mono: true,
    dense: false,
    testId: "story-kv-playground",
  },
  argTypes: {
    label: { control: "text", description: "Label element content (dt)." },
    value: { control: "text", description: "Value element content (dd)." },
    hint: { control: "text", description: "Optional secondary line under the value." },
    tone: {
      control: "select",
      options: ["default", "dimmed", "success", "error", "warning", "primary", "info"],
      description: "Financial text tone, mirrored from the @/ui Text tone vocabulary.",
    },
    align: { control: "inline-radio", options: ["left", "right"], description: "Where label, value and hint align." },
    mono: { control: "boolean", description: "Monospaced face for price/P&L figures." },
    dense: { control: "boolean", description: "Smaller type and tighter gaps." },
    testId: { control: "text", description: "Root test id; children get -label / -value / -hint suffixes." },
  },
};
export default meta;
type Story = StoryObj<KeyValueArgs>;

/** Controls are bound to the real KeyValueProps. */
export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <KVFrame>
        <KVPanel
          title="Key / value · playground"
          detail={FIXTURE_LABEL}
          meta={`tone: ${args.tone} · align: ${args.align}`}
          testId="story-kv-playground-frame"
        >
          <Specimen label="Live control binding" detail="Args map straight onto KeyValueProps.">
            <Stack gap="xs" style={{ width: "100%", "max-width": "360px" }}>
              <KeyValue
                label={args.label}
                value={args.value}
                hint={args.hint}
                tone={args.tone}
                align={args.align}
                mono={args.mono}
                dense={args.dense}
                testId={args.testId}
              />
            </Stack>
          </Specimen>
        </KVPanel>
      </KVFrame>
    )),
};

export const Tones: Story = {
  render: () =>
    solidStory(() => (
      <KVFrame>
        <KVPanel
          title="Key / value · semantic tones"
          detail={FIXTURE_LABEL}
          meta="7 tones · frozen quote fields"
          testId="story-kv-tones-frame"
        >
          <KVSpecimenGrid>
            <KeyValue label="Spot" value={SPOT} hint={CHANGE} tone="success" mono />
            <KeyValue label="Day P&L" value="-₹1,880.00" tone="error" mono />
            <KeyValue label="Margin" value="82% used" tone="warning" />
            <KeyValue label="Feed" value="DELAYED" tone="info" />
            <KeyValue label="Source" value="Upstox V3" tone="primary" />
            <KeyValue label="Notes" value="no notes" tone="dimmed" />
            <KeyValue label="Default" value="1.12" />
          </KVSpecimenGrid>
        </KVPanel>
      </KVFrame>
    )),
};

export const AlignmentAndDensity: Story = {
  render: () =>
    solidStory(() => (
      <KVFrame>
        <KVPanel
          title="Key / value · alignment and density"
          detail={`${FIXTURE_LABEL} · left vs right, regular vs dense`}
          meta="2 alignments · 2 densities"
          testId="story-kv-alignment-frame"
        >
          <KVSpecimenGrid>
            <Specimen label="Left aligned">
              <Stack gap="xs">
                <KeyValue label="Expiry" value="26 Nov 2026 · weekly" align="left" />
                <KeyValue label="Strike" value="23,400" align="left" dense />
              </Stack>
            </Specimen>
            <Specimen label="Right aligned">
              <Stack gap="xs">
                <KeyValue label="Max pain" value="23,400" align="right" />
                <KeyValue label="PCR (OI)" value="1.12" align="right" dense />
              </Stack>
            </Specimen>
          </KVSpecimenGrid>
        </KVPanel>
      </KVFrame>
    )),
};

export const Deltas: Story = {
  render: () =>
    solidStory(() => (
      <KVFrame>
        <KVPanel
          title="Delta and KeyValuePair · spoken P&L"
          detail={`${FIXTURE_LABEL} · grouped spoken phrase, aria-hidden separators`}
          meta="3 delta directions · 1 composed pair"
          testId="story-kv-deltas-frame"
        >
          <Stack gap="md">
            <Specimen label="Delta directions">
              <Stack gap="sm">
                <Delta entry="23,412.40" mark="23,450.85" pnl="+38.45" value={38.45} mono testId="story-delta-up" />
                <Delta entry="2,841.50" mark="2,832.10" pnl="-9.40" value={-9.4} mono testId="story-delta-down" />
                <Delta
                  entry="4,120.00"
                  mark="4,120.00"
                  pnl="0.00"
                  value={0}
                  ariaLabel="Entry 4,120 to mark 4,120, no change"
                  testId="story-delta-flat"
                />
              </Stack>
            </Specimen>
            <Specimen label="Composed pair">
              <KeyValuePair
                label="NIFTY 24SEP FUT"
                entry="23,412.40"
                mark="23,450.85"
                pnl="+38.45"
                pnlValue={38.45}
                hint="75 qty · frozen fixture"
                mono
                testId="story-kv-pair"
              />
            </Specimen>
          </Stack>
        </KVPanel>
      </KVFrame>
    )),
};

export const Grid: Story = {
  render: () =>
    solidStory(() => (
      <KVFrame>
        <KVPanel
          title="KeyValueGrid · auto-fit columns"
          detail={`${FIXTURE_LABEL} · auto-fit KeyValueGrid, stacks before a figure clips`}
          meta="8 frozen fields"
          testId="story-kv-grid-frame"
        >
          <KeyValueGrid gap="md" testId="story-kv-grid">
            <KeyValue label="Spot" value={SPOT} tone="success" mono />
            <KeyValue label="Change" value="+18.42" hint="0.08%" tone="success" mono />
            <KeyValue label="PCR (OI)" value="1.12" mono />
            <KeyValue label="Max pain" value="23,400" mono />
            <KeyValue label="Open interest" value="1,204,500" mono />
            <KeyValue label="Volume" value="842,310" mono />
            <KeyValue label="Updated" value="09:15:00 IST" tone="dimmed" />
            <KeyValue label="Feed" value="DELAYED" tone="info" />
          </KeyValueGrid>
        </KVPanel>
      </KVFrame>
    )),
};
