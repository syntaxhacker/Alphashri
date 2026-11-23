import type { JSX } from "solid-js";
import { Box, Paper, Stack, Text } from "@/ui";

/** Static catalogue metadata: no wall clock, no network, no generated values. */
export const FIXTURE_LABEL = "frozen feedback specimens · 2026-11-20 session";

export function Catalog(props: { title: string; note: string; children: JSX.Element }) {
  return (
    <Stack gap="lg" style={{ width: "100%", "max-width": "1280px", margin: "0 auto" }}>
      <Stack gap="xs" style={{ "border-left": "3px solid var(--color-fin-primary)", "padding-left": "12px" }}>
        <Text size="lg" fw={700}>{props.title}</Text>
        <Text size="xs" c="dimmed">{props.note}</Text>
        <Text size="xs" c="dimmed" style={{ "font-family": "var(--font-mono)" }}>{FIXTURE_LABEL}</Text>
      </Stack>
      {props.children}
    </Stack>
  );
}

export function Section(props: { title: string; note?: string; children: JSX.Element }) {
  return (
    <Paper
      p="md"
      radius="md"
      bg="var(--color-fin-surface-alt)"
      style={{ border: "1px solid var(--color-fin-border)", width: "100%" }}
    >
      <Stack gap="md">
        <Stack gap="xs">
          <Text size="sm" fw={700} tt="uppercase" style={{ "letter-spacing": "0.08em" }}>
            {props.title}
          </Text>
          {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
        </Stack>
        <Box style={{ "border-top": "1px solid var(--color-fin-border)", "padding-top": "16px", width: "100%" }}>
          {props.children}
        </Box>
      </Stack>
    </Paper>
  );
}

export function SpecimenGrid(props: { children: JSX.Element; min?: number }) {
  return (
    <Box
      style={{
        display: "grid",
        "grid-template-columns": `repeat(auto-fill, minmax(${props.min ?? 180}px, 1fr))`,
        gap: "16px",
        width: "100%",
      }}
    >
      {props.children}
    </Box>
  );
}

export function Specimen(props: { label: string; children: JSX.Element; fill?: boolean }) {
  return (
    <Paper
      p="sm"
      radius="sm"
      bg="var(--color-fin-surface)"
      style={{ border: "1px solid var(--color-fin-border)", "min-height": "80px" }}
    >
      <Stack gap="sm" align={props.fill ? undefined : "center"} justify="center" style={{ "min-height": "56px" }}>
        <Box
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": props.fill ? "flex-start" : "center",
            "min-height": "40px",
            width: props.fill ? "100%" : undefined,
          }}
        >
          <Box style={props.fill ? { flex: 1, "min-width": 0 } : undefined}>{props.children}</Box>
        </Box>
        <Text size="xs" c="dimmed" ta={props.fill ? "left" : "center"}>{props.label}</Text>
      </Stack>
    </Paper>
  );
}
