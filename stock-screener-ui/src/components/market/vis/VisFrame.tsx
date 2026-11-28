import type { JSX } from "solid-js";
import { Box, Text, ToolbarRow } from "@/ui";
import { VIZ_BG, VIZ_GRID, VIZ_MUTED, VIZ_TEXT } from "@/ui/palette";

/**
 * The wrapper chrome shared by the Vis views that fill the tab, open with a
 * title row and replace their body with one centred message when empty.
 * Each primitive here was copied byte-for-byte from the views that use it;
 * views with extra root classes, a different toolbar contract or a different
 * empty tag keep their own markup rather than being normalised to fit.
 */
export function VisFrame(props: { testId: string; children: JSX.Element }) {
  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid={props.testId}
    >
      {props.children}
    </Box>
  );
}

/** Identical title opener in the 52-week range and relative-volume toolbars. */
export function VisTitle(props: { children: JSX.Element }) {
  return (
    <Text size="xs" fw={600} c={VIZ_TEXT} className="whitespace-nowrap">
      {props.children}
    </Text>
  );
}

/** Identical toolbar chrome in the RSI×ADX and sector 52W breadth views. */
export function VisToolbar(props: { testId: string; children: JSX.Element }) {
  return (
    <ToolbarRow
      gap={8}
      wrap={false}
      className="h-10 flex-shrink-0 border-b px-2"
      style={{ "border-color": VIZ_GRID }}
      data-testid={props.testId}
    >
      {props.children}
    </ToolbarRow>
  );
}

/** Identical empty state in RSI×ADX, sector 52W breadth and the theme board. */
export function VisEmpty(props: { message: string; testId: string }) {
  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
      data-testid={props.testId}
    >
      <Text span size="sm" c={VIZ_MUTED}>
        {props.message}
      </Text>
    </Box>
  );
}
