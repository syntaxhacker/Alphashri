import type { JSX } from "solid-js";
import { Divider, Paper, Stack, Text } from "@/ui";

export const longText =
  "Open interest builds on the call wall while spot holds above the put wall, so the 5-minute flow read stays constructive into expiry.";

/** Framed, labelled specimen section shared by the typography catalog. */
export function Section(props: { title: string; note?: string; children: JSX.Element }) {
  return (
    <Paper p="md" radius="md" style={{ border: "1px solid var(--color-fin-border)", width: "100%" }}>
      <Stack gap="sm">
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
