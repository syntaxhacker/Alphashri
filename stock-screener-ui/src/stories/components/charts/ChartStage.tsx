import type { JSX } from "solid-js";
import { Box } from "@/ui";

export const CHART_HEIGHT = 460;

/**
 * The Vis surfaces are `flex-1 min-h-0` children: without a flex column of
 * measured height their canvases collapse in a Storybook canvas. This supplies
 * the same bounded frame the Market tab gives them, without app chrome.
 */
export function ChartStage(props: { height?: number; children: JSX.Element }): JSX.Element {
  return (
    <Box
      style={{
        display: "flex",
        "flex-direction": "column",
        height: `${props.height ?? CHART_HEIGHT}px`,
        "min-width": 0,
        "max-width": "100%",
        overflow: "hidden",
        "border-radius": "4px",
        border: "1px solid var(--color-fin-border)",
      }}
    >
      {props.children}
    </Box>
  );
}
