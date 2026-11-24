import { createMemo, For } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";
import { wallsStatCells } from "./NiftyWallsExpanded.format";

export function WallsStatStrip(props: { walls: WallsPayload }) {
  const cells = createMemo(() => wallsStatCells(props.walls));
  return (
    <div class="w-full min-w-0">
      <div data-testid="walls-stat-scroll" class="w-full min-w-0 overflow-x-auto">
        <div
          class={`grid grid-cols-[repeat(7,minmax(0,1fr))] min-w-[840px] border border-solid bg-surface-alt`}
          style={{
            display: "grid",
            "grid-template-columns": "repeat(7, minmax(0,1fr))",
            border: `1px solid ${palette.BORDER}`,
            "background-color": palette.SURFACE_ALT,
          }}
        >
          <For each={cells()}>{(cell, index) => (
            <div
              data-index={index()}
              style={{
                "padding-left": `${REPORT_PAD.sm}px`,
                "padding-right": `${REPORT_PAD.sm}px`,
                "padding-top": `${REPORT_PAD.xs}px`,
                "padding-bottom": `${REPORT_PAD.xs}px`,
                "min-width": 0,
                "border-right": index() < cells().length - 1 ? `1px solid ${palette.BORDER}` : "none",
              }}
            >
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                style={{
                  "font-size": `${REPORT_FONT.micro}px`,
                  "line-height": REPORT_LINE_HEIGHT.tight,
                  color: palette.TEXT_MUTED,
                  "letter-spacing": REPORT_LETTER_SPACING.wide,
                  "font-weight": REPORT_FONT_WEIGHT.extrabold,
                }}
              >
                {cell.label}
              </Text>
              <Text
                size="sm"
                span
                fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                className="font-mono tabular-nums whitespace-nowrap"
                style={{
                  "font-size": `${REPORT_FONT.md}px`,
                  "line-height": REPORT_LINE_HEIGHT.snug,
                  "font-weight": REPORT_FONT_WEIGHT.bold,
                  color: cell.color ?? palette.TEXT_COLOR,
                  "font-variant-numeric": "tabular-nums",
                  "white-space": "nowrap",
                }}
              >
                {cell.value}
              </Text>
            </div>
          )}</For>
        </div>
      </div>
      <div
        data-testid="walls-stat-scroll-cue"
        class="text-ui-micro text-fin-text-muted mt-1 min-[840px]:hidden"
      >
        scroll → for all seven stats
      </div>
    </div>
  );
}
