import { For } from "solid-js";
import { Badge, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";
import { wallsDteLabel, wallsStateColor } from "./NiftyWallsExpanded.format";

export type WallsView = "MAP" | "DATA";

export function WallsModalHeader(props: { walls: WallsPayload }) {
  const stateColor = () => wallsStateColor(props.walls);
  return (
    <div class="flex flex-wrap items-center" style={{ "row-gap": "4px" }}>
      <Text
        size="lg"
        span
        fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.lg}px`,
          "font-weight": REPORT_FONT_WEIGHT.extrabold,
          "letter-spacing": REPORT_LETTER_SPACING.wider,
        }}
      >
        WALLS · {props.walls.symbol}
      </Text>
      <Badge
        size="xs"
        variant="outline"
        color={stateColor()}
        style={{
          "height": "20px",
          "font-size": `${REPORT_FONT.xs}px`,
          "font-weight": REPORT_FONT_WEIGHT.extrabold,
          color: stateColor(),
          "background-color": "transparent",
          border: `1px solid ${stateColor()}`,
          "padding-left": `${REPORT_PAD.sm}px`,
          "padding-right": `${REPORT_PAD.sm}px`,
        }}
      >
        {props.walls.state.replace("_", " ")}
      </Badge>
      <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
        {wallsDteLabel(props.walls)} · {props.walls.expiry ?? "—"} · {props.walls.freshness.rows} rows
      </Text>
    </div>
  );
}

export function WallsViewToggle(props: {
  active: WallsView;
  hasMap: boolean;
  onChoose: (mode: WallsView) => void;
}) {
  return (
    <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between", gap: `${REPORT_PAD.sm}px` }}>
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          "font-weight": REPORT_FONT_WEIGHT.bold,
          "letter-spacing": REPORT_LETTER_SPACING.wide,
          color: palette.TEXT_MUTED,
        }}
      >
        VIEW
      </Text>
      <div class="flex items-center gap-[4px]">
        <For each={["MAP", "DATA"] as const}>{(mode) => (
          <Button
            size="xs"
            aria-pressed={props.active === mode}
            disabled={mode === "MAP" && !props.hasMap}
            onClick={() => props.onChoose(mode)}
            className="min-w-0"
            style={{
              "min-width": 0,
              "padding-left": `${REPORT_PAD.sm}px`,
              "padding-right": `${REPORT_PAD.sm}px`,
              "padding-top": "4px",
              "padding-bottom": "4px",
              "font-size": `${REPORT_FONT.xs}px`,
              "font-weight": REPORT_FONT_WEIGHT.extrabold,
              "line-height": 1.4,
              color: props.active === mode ? palette.TEXT_COLOR : palette.TEXT_MUTED,
              "background-color": props.active === mode ? palette.SURFACE_ALT : "transparent",
              border: `1px solid ${props.active === mode ? palette.BORDER : "transparent"}`,
              "border-radius": "2px",
            }}
          >
            {mode}
          </Button>
        )}</For>
      </div>
    </div>
  );
}

export function WallsDisclaimer() {
  return (
    <Text
      size="xs"
      span
      style={{
        "font-size": `${REPORT_FONT.micro}px`,
        color: palette.TEXT_MUTED,
      }}
    >
      Heuristic positioning read — not advice. The tape is 1-minute; chain10s is 10s. The morning is only present if the recorder ran.
    </Text>
  );
}
