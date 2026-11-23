import { Show, type JSX } from "solid-js";
import { Box, Group, Paper, Stack, Text } from "@/ui";

/** Shared specimen widths — wide enough that no data column is clipped. */
export const DEMO_WIDTH = 880;
export const TABLE_WIDTH = 880;
export const PAPER_TABLE_WIDTH = 840;

/**
 * One bordered surface per specimen: a raised header on the surface ramp, a
 * single hairline divider, then the demo body. Tables pass `flush` so the
 * table's own Paper (or bare markup) supplies the only frame.
 */
export function DemoPanel(props: {
  title: string;
  detail?: string;
  meta?: string;
  metaNode?: JSX.Element;
  width?: number;
  flush?: boolean;
  testId?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Paper
      component="section"
      w={props.width ?? DEMO_WIDTH}
      radius={6}
      testId={props.testId}
      style={{
        border: "1px solid var(--color-fin-border)",
        "background-color": "var(--color-fin-surface)",
        overflow: "hidden",
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
        <Group justify="space-between" align="center" gap="md" wrap="nowrap">
          <Text size="sm" fw={700} c="default">{props.title}</Text>
          <Show when={props.metaNode ?? props.meta}>
            <Text size="xs" c="secondary" style={{ "white-space": "nowrap", "font-variant-numeric": "tabular-nums" }}>
              {props.metaNode ?? props.meta}
            </Text>
          </Show>
        </Group>
        <Show when={props.detail}>
          <Text size="xs" c="secondary">{props.detail}</Text>
        </Show>
      </Stack>
      <Box style={props.flush ? undefined : { padding: "16px" }}>{props.children}</Box>
    </Paper>
  );
}

/** A labelled block inside a panel; keeps a consistent title/body rhythm. */
export function Specimen(props: {
  label: string;
  detail?: string;
  width?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Stack gap="xs" style={{ width: props.width ?? "100%", "min-width": 0 }}>
      <Text size="xs" fw={700} c="secondary" tt="uppercase">{props.label}</Text>
      <Show when={props.detail}>
        <Text size="xs" c="secondary">{props.detail}</Text>
      </Show>
      {props.children}
    </Stack>
  );
}

/** Page-level wrapper: one column, consistent gaps, no nested borders. */
export function DemoStack(props: { width?: number; children: JSX.Element }): JSX.Element {
  return (
    <Stack gap="md" style={{ width: `${props.width ?? DEMO_WIDTH}px`, "max-width": "100%", "min-width": 0 }}>
      {props.children}
    </Stack>
  );
}
