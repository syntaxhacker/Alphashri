import { For, Show } from "solid-js";
import { Text } from "@/ui";
import { Sparkline } from "@/components/common/Sparkline";
import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload } from "@/api/reportNifty";
import { erosionColor, firstBreakEvent, fmtNum, fmtPct } from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_PAD,
} from "./reportTokens";

export function SequenceLine(props: { events: WallsEvent[] }) {
  const recent = () => props.events.slice(-3);
  const hidden = () => props.events.length - recent().length;
  const firstBreakAt = () => firstBreakEvent(props.events)?.at;
  return (
    <div class="flex items-center gap-[8px] min-w-0 overflow-hidden" style={{ "margin-left": `${REPORT_PAD.sm}px` }}>
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          color: palette.TEXT_MUTED,
          "letter-spacing": REPORT_LETTER_SPACING.wider,
          "flex-shrink": 0,
        }}
      >
        SEQ
      </Text>
      <Show when={hidden() > 0}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED, "flex-shrink": 0 }}>
          +{hidden()}
        </Text>
      </Show>
      <For each={recent()}>{(event) => {
        const isBreak = event.kind === "BREAK";
        const isFirst = isBreak && event.at === firstBreakAt();
        return (
          <div
            data-wall-anim=""
            class="flex items-center gap-[4px] shrink-0"
            style={{
              display: "flex",
              "align-items": "center",
              gap: `${REPORT_PAD.xs}px`,
              "flex-shrink": 0,
              animation: "wall-event-in 160ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            <div class="w-[4px] h-[4px] rounded-full shrink-0" style={{ "background-color": isBreak ? palette.NEGATIVE : palette.WARNING }} />
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.micro}px`,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {event.at.slice(11, 16)}
            </Text>
            <Text
              size="xs"
              span
              fw={isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium}
              style={{
                "font-size": `${REPORT_FONT.xsPlus}px`,
                "font-weight": isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
              }}
            >
              {isBreak ? (isFirst ? "BREAK" : "RE-BRK") : "TOUCH"}
            </Text>
          </div>
        );
      }}</For>
    </div>
  );
}

export function MiniHistory(props: { walls: WallsPayload }) {
  const callValues = () => props.walls.history.map((point) => point.call_oi ?? null);
  const putValues = () => props.walls.history.map((point) => point.put_oi ?? null);
  const first = () => props.walls.history[0];
  const last = () => props.walls.history[props.walls.history.length - 1];
  return (
    <div class="min-w-0">
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
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
          TRACKED WALL {fmtNum(props.walls.call_wall.strike)} · LAST {props.walls.window_min}m
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          {first()?.t?.slice(11, 16)} → {last()?.t?.slice(11, 16)}
        </Text>
      </div>
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between", "margin-top": `${REPORT_PAD.xs}px` }}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>call OI · 30m Δ</Text>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            "font-weight": REPORT_FONT_WEIGHT.bold,
            color: erosionColor(props.walls.tracked_call_erosion_30m),
          }}
        >
          {fmtPct(props.walls.tracked_call_erosion_30m)}
        </Text>
      </div>
      <Sparkline values={callValues()} width={420} height={18} color={palette.OI_CALL} testId="walls-card-call-spark" animate responsive />
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>put OI · 30m Δ</Text>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            "font-weight": REPORT_FONT_WEIGHT.bold,
            color: erosionColor(props.walls.tracked_put_build_30m),
          }}
        >
          {fmtPct(props.walls.tracked_put_build_30m)}
        </Text>
      </div>
      <Sparkline values={putValues()} width={420} height={18} color={palette.OI_PUT} testId="walls-card-put-spark" animate responsive />
    </div>
  );
}
