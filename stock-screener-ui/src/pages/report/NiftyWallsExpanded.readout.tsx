import { For } from "solid-js";
import { Badge, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import { firstBreakEvent, lastBreakEvent } from "./niftyWallsFormat";
import {
  wallsBreakDetail,
  wallsBreakHeadline,
  wallsGapLabel,
  wallsReadText,
  wallsRebreakDetail,
} from "./NiftyWallsExpanded.format";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

export function WallsReadout(props: {
  walls: WallsPayload;
  onReplayBreak?: (at: string) => void;
}) {
  const alert = () => props.walls.alert;
  const firstBreak = () => firstBreakEvent(props.walls.events ?? []);
  const lastBreak = () => lastBreakEvent(props.walls.events ?? []);
  const primaryBreak = () => alert() ?? firstBreak() ?? lastBreak() ?? null;
  return (
    <div class="grid grid-cols-1 md:grid-cols-[1.4fr_1fr]" style={{ gap: `${REPORT_PAD.md}px` }}>
      <div>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
            "margin-bottom": `${REPORT_PAD.sm}px`,
          }}
        >
          READ
        </Text>
        <Text
          data-testid="walls-read"
          size="sm"
          span
          style={{
            "font-size": `${REPORT_FONT.sm}px`,
            "line-height": REPORT_LINE_HEIGHT.relaxed,
            color: palette.TEXT_COLOR,
          }}
        >
          {wallsReadText(props.walls)}
        </Text>
        <div class="flex-wrap" style={{ "flex-wrap": "wrap", "row-gap": "4px", "margin-top": `${REPORT_PAD.md}px` }}>
          <For each={props.walls.reasons}>{(reason) => (
            <Badge
              size="xs"
              variant="light"
              color="default"
              className="min-w-0"
              style={{
                "height": "19px",
                "font-size": `${REPORT_FONT.xs}px`,
                color: palette.TEXT_MUTED,
                "background-color": palette.SURFACE_ALT,
                "padding-left": `${REPORT_PAD.sm}px`,
                "padding-right": `${REPORT_PAD.sm}px`,
              }}
            >
              {reason}
            </Badge>
          )}</For>
        </div>
      </div>
      <div>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
            "margin-bottom": `${REPORT_PAD.sm}px`,
          }}
        >
          BREAK
        </Text>
        {primaryBreak() ? (
          <div data-testid="walls-break" style={{ "border-left": `3px solid ${palette.NEGATIVE}`, "padding-left": `${REPORT_PAD.md}px`, "padding-top": `${REPORT_PAD.xs}px`, "padding-bottom": `${REPORT_PAD.xs}px` }}>
            <Text
              size="md"
              span
              fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": `${REPORT_FONT.md}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                color: palette.NEGATIVE,
              }}
            >
              {wallsBreakHeadline(alert(), primaryBreak()!)}
            </Text>
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
              }}
            >
              {wallsBreakDetail(primaryBreak()!)}
            </Text>
            {lastBreak() && lastBreak()!.at !== primaryBreak()!.at && (
              <Text
                size="xs"
                span
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "line-height": REPORT_LINE_HEIGHT.relaxed,
                  color: palette.WARNING,
                }}
              >
                {wallsRebreakDetail(lastBreak()!)}
              </Text>
            )}
            <Button
              size="xs"
              data-testid="walls-replay-break"
              disabled={!props.onReplayBreak}
              onClick={() => props.onReplayBreak?.(primaryBreak()!.at)}
              className="min-w-0"
              style={{
                "margin-top": `${REPORT_PAD.sm}px`,
                "min-width": 0,
                "padding-left": `${REPORT_PAD.sm}px`,
                "padding-right": `${REPORT_PAD.sm}px`,
                "padding-top": "4px",
                "padding-bottom": "4px",
                "font-size": `${REPORT_FONT.xs}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                "line-height": 1.4,
                color: palette.PRIMARY,
                border: `1px solid ${palette.PRIMARY}`,
                "border-radius": "2px",
              }}
            >
              REPLAY BREAK
            </Button>
          </div>
        ) : (
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
            No confirmed break in the recorded window.
          </Text>
        )}
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            "line-height": REPORT_LINE_HEIGHT.relaxed,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.md}px`,
          }}
        >
          Freshness: last {props.walls.freshness.last_t.slice(11, 19)} · age {Math.round(props.walls.freshness.age_sec)}s ·
          {props.walls.freshness.stale ? "STALE" : "fresh"}
          {wallsGapLabel(props.walls)}
        </Text>
      </div>
    </div>
  );
}
