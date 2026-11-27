import type { JSX } from "solid-js";
import { Box, Group, Paper, Stack, Text } from "@/ui";

/** Local specimen chrome — theme variables only, so it follows the active theme. */
export function Page(props: { children: JSX.Element }) {
  return (
    <Stack gap="lg" style={{ width: "100%", "max-width": "880px", "box-sizing": "border-box" }}>
      {props.children}
    </Stack>
  );
}

export function Specimen(props: {
  title: string;
  code?: string;
  note?: string;
  children: JSX.Element;
}) {
  return (
    <Paper
      p="md"
      radius="sm"
      style={{
        border: "1px solid var(--color-fin-border)",
        background: "var(--color-fin-surface)",
        width: "100%",
        "min-width": 0,
        "box-sizing": "border-box",
      }}
    >
      <Stack gap="sm">
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">
            {props.title}
          </Text>
          {props.code ? (
            <Text size="xs" c="primary" className="font-mono">{props.code}</Text>
          ) : null}
          {props.note ? (
            <Text size="xs" c="dimmed" style={{ "line-height": 1.5 }}>{props.note}</Text>
          ) : null}
        </Stack>
        <Box style={{ width: "24px", height: "2px", background: "var(--color-fin-primary)" }} />
        <Box style={{ "min-width": 0, width: "100%" }}>{props.children}</Box>
      </Stack>
    </Paper>
  );
}

/** Single column in a narrow preview, multiple columns on a wide canvas. */
export function SpecimenGrid(props: { children: JSX.Element; min?: number }) {
  return (
    <Box
      style={{
        display: "grid",
        gap: "16px",
        "grid-template-columns": `repeat(auto-fit, minmax(${props.min ?? 300}px, 1fr))`,
        "align-items": "start",
        width: "100%",
      }}
    >
      {props.children}
    </Box>
  );
}

export function Stage(props: { children: JSX.Element; height?: number }) {
  return (
    <Box
      style={{
        position: "relative",
        height: `${props.height ?? 200}px`,
        padding: "12px",
        overflow: "hidden",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface-alt)",
      }}
    >
      {props.children}
    </Box>
  );
}

export function Readout(props: { children: JSX.Element }) {
  return (
    <Box
      style={{
        padding: "8px 12px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface-alt)",
        "min-width": 0,
      }}
    >
      <Text size="xs" c="dimmed" className="font-mono" style={{ "line-height": 1.5 }}>
        {props.children}
      </Text>
    </Box>
  );
}

export function SampleRow(props: { label: string; value: string; tone?: string }) {
  return (
    <Group
      gap="sm"
      align="center"
      justify="space-between"
      style={{
        padding: "8px 12px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface)",
        "min-width": 0,
      }}
    >
      <Text size="xs" fw={600} style={{ color: "var(--color-fin-text)" }}>{props.label}</Text>
      <Text size="xs" className="font-mono" style={{ color: props.tone ?? "var(--color-fin-text-muted)" }}>
        {props.value}
      </Text>
    </Group>
  );
}
