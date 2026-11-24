import { Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload } from "@/api/reportNifty";
import { fmtNum, fmtPct } from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";
import { SequenceLine } from "./NiftyWallsCard.history";

export function WallsRead(props: {
  walls: WallsPayload;
  alert: WallsPayload["alert"];
  showAlert: boolean;
  breakEvent: WallsEvent | null;
  lastBreak: WallsEvent | null;
  events: WallsEvent[];
  onDismiss: (at: string, wall: number) => void;
}) {
  return (
    <div
      style={{
        "min-width": 0,
        display: "grid",
        "grid-template-columns": "minmax(0,1.15fr) minmax(0,1fr)",
        gap: `${REPORT_PAD.md}px`,
      }}
    >
      <div style={{ "min-width": 0, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.sm}px` }}>
        {props.showAlert && props.alert ? (
          <div
            data-testid="nifty-walls-alert"
            data-wall-anim=""
            style={{
              "border-left": `3px solid ${palette.NEGATIVE}`,
              "background-color": palette.SURFACE_ALT,
              "padding-left": `${REPORT_PAD.sm}px`,
              "padding-top": `${REPORT_PAD.xs}px`,
              "padding-bottom": `${REPORT_PAD.xs}px`,
              animation: "wall-alert-in 180ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            <div class="flex items-center justify-between gap-2" style={{ "align-items": "center", "justify-content": "space-between", gap: `${REPORT_PAD.sm}px` }}>
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "font-weight": REPORT_FONT_WEIGHT.extrabold,
                  color: palette.NEGATIVE,
                  "white-space": "nowrap",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                }}
              >
                WALL BREAK · {fmtNum(props.alert!.wall)} · {fmtNum(props.alert!.spot, 1)}
              </Text>
              <Button
                size="xs"
                variant="filled"
                onClick={() => props.onDismiss(props.alert!.at, props.alert!.wall)}
                className="min-w-0 shrink-0"
                style={{
                  "min-width": 0,
                  "padding-left": `${REPORT_PAD.xs}px`,
                  "padding-right": `${REPORT_PAD.xs}px`,
                  "font-size": `${REPORT_FONT.micro}px`,
                  color: palette.TEXT_MUTED,
                  "flex-shrink": 0,
                }}
              >
                dismiss
              </Button>
            </div>
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xsPlus}px`,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
              }}
            >
              call {fmtPct(props.alert!.erosion_30m)} · put {fmtPct(props.alert!.put_build_30m)} · {props.alert!.at.slice(11, 19)}
            </Text>
          </div>
        ) : props.breakEvent ? (
          <div style={{ "padding-left": `${REPORT_PAD.sm}px`, "border-left": `2px solid ${palette.NEGATIVE}`, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.xs}px` }}>
            <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                style={{
                  "font-size": `${REPORT_FONT.micro}px`,
                  "font-weight": REPORT_FONT_WEIGHT.extrabold,
                  color: palette.TEXT_MUTED,
                  "letter-spacing": REPORT_LETTER_SPACING.wide,
                }}
              >
                FIRST BREAK
              </Text>
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                className="font-mono tabular-nums"
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "font-weight": REPORT_FONT_WEIGHT.extrabold,
                  color: palette.NEGATIVE,
                  "font-variant-numeric": "tabular-nums",
                }}
              >
                {props.breakEvent!.at.slice(11, 19)} · {fmtNum(props.breakEvent!.wall)}
              </Text>
              <Text
                size="xs"
                span
                style={{
                  "font-size": `${REPORT_FONT.xsPlus}px`,
                  color: palette.TEXT_MUTED,
                }}
              >
                call {fmtPct(props.breakEvent!.erosion_30m)} · put {fmtPct(props.breakEvent!.put_build_30m)}
              </Text>
            </div>
            {props.lastBreak && props.lastBreak!.at !== props.breakEvent!.at && (
              <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
                <Text
                  size="xs"
                  span
                  fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                  style={{
                    "font-size": `${REPORT_FONT.micro}px`,
                    "font-weight": REPORT_FONT_WEIGHT.extrabold,
                    color: palette.WARNING,
                    "letter-spacing": REPORT_LETTER_SPACING.wide,
                  }}
                >
                  RE-BROKE
                </Text>
                <Text
                  size="xs"
                  span
                  fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                  className="font-mono tabular-nums"
                  style={{
                    "font-size": `${REPORT_FONT.xs}px`,
                    "font-weight": REPORT_FONT_WEIGHT.bold,
                    color: palette.WARNING,
                    "font-variant-numeric": "tabular-nums",
                  }}
                >
                  {props.lastBreak!.at.slice(11, 19)} · {fmtNum(props.lastBreak!.wall)}
                </Text>
                <Text
                  size="xs"
                  span
                  style={{
                    "font-size": `${REPORT_FONT.xsPlus}px`,
                    color: palette.TEXT_MUTED,
                  }}
                >
                  call {fmtPct(props.lastBreak!.erosion_30m)} · put {fmtPct(props.lastBreak!.put_build_30m)}
                </Text>
              </div>
            )}
          </div>
        ) : props.walls.expiry_day ? (
          <Text
            size="xs"
            span
            style={{
              "font-size": `${REPORT_FONT.xs}px`,
              "line-height": REPORT_LINE_HEIGHT.relaxed,
              color: palette.TEXT_MUTED,
            }}
          >
            No confirmed break in the window.
          </Text>
        ) : null}
        <SequenceLine events={props.events} />
      </div>

      <div style={{ "min-width": 0, "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`, "padding-left": `${REPORT_PAD.sm}px` }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
          }}
        >
          READ
        </Text>
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.xsPlus}px`,
            "line-height": REPORT_LINE_HEIGHT.relaxed,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.xs}px`,
          }}
        >
          {props.walls.reasons.slice(0, 4).join(" · ")}
        </Text>
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.xsPlus}px`,
            "line-height": REPORT_LINE_HEIGHT.relaxed,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          {props.walls.expiry_day ? "break = erosion + put floor" : "Non-expiry: positioning, not gamma"}
        </Text>
      </div>
    </div>
  );
}
