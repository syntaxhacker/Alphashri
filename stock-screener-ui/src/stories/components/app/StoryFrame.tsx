import type { JSX } from "solid-js";
import { Box, Stack } from "@/ui";

/** Shared specimen widths — wide enough that no data column is clipped. */
export const DEMO_WIDTH = 880;
export const TABLE_WIDTH = 880;
export const PAPER_TABLE_WIDTH = 840;

/**
 * title/detail/meta/flush stay on the signature for API compatibility: all 81
 * stories pass them unchanged, but a Storybook canvas shows the component
 * itself, so none of that chrome is painted here.
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
    <Box
      data-testid={props.testId}
      style={{
        width: "100%",
        ...(props.width != null ? { "max-width": `${props.width}px` } : {}),
      }}
    >
      {props.children}
    </Box>
  );
}

/** label/detail stay for API compatibility; only the width bound is painted. */
export function Specimen(props: {
  label: string;
  detail?: string;
  width?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Box style={{ width: props.width ?? "100%", "min-width": 0 }}>
      {props.children}
    </Box>
  );
}

/** Page-level wrapper: column, gap and width only, with no visible chrome. */
export function DemoStack(props: { width?: number; children: JSX.Element }): JSX.Element {
  return (
    <Stack gap="md" style={{ width: `${props.width ?? DEMO_WIDTH}px`, "max-width": "100%", "min-width": 0, margin: "0 auto" }}>
      {props.children}
    </Stack>
  );
}
