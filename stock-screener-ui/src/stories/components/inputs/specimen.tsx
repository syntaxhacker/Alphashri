import type { JSX } from "solid-js";
import { Divider, Paper, SimpleGrid, Stack, Text } from "@/ui";

/**
 * Shared specimen frame for the input catalog. A labelled, bordered surface
 * gives each control a context instead of leaving it on the bare story canvas;
 * the border uses the theme hairline token so it follows light/dark themes.
 */
export function Specimen(props: {
  title: string;
  note?: string;
  children: JSX.Element;
  width?: number | string;
}) {
  return (
    <Paper
      component="section"
      p="lg"
      radius="md"
      maw={props.width ?? 920}
      style={{ width: "100%", border: "1px solid var(--color-fin-border)" }}
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">{props.title}</Text>
          {props.note ? <Text size="xs" c="dimmed">{props.note}</Text> : null}
          <Divider />
        </Stack>
        {props.children}
      </Stack>
    </Paper>
  );
}

/** Consistent outer rhythm and a readable measure for every inputs story. */
export function SpecimenCanvas(props: { children: JSX.Element }) {
  return (
    <Stack gap="lg" style={{ width: "100%", "max-width": "960px", margin: "0 auto" }}>
      {props.children}
    </Stack>
  );
}

/** Equal, min-width-safe cells for a row of related controls. */
export function SpecimenGrid(props: { children: JSX.Element; cols?: number }) {
  return (
    <SimpleGrid cols={props.cols ?? 2} spacing="lg" style={{ width: "100%" }}>
      {props.children}
    </SimpleGrid>
  );
}
