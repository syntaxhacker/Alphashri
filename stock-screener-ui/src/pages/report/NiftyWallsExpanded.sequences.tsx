import { createMemo, For } from "solid-js";
import { Text } from "@/ui";
import { alpha } from "@/ui/alpha";
import { Sparkline } from "@/components/common/Sparkline";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import * as palette from "@/ui/palette";
import {
  wallCode,
  wallSide,
} from "./niftyChartMath";
import {
  erosionColor,
  firstBreakEvent,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtSignedOI,
  wallsMaxOi,
} from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_ROW,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

function LadderRow(props: {
  row: WallsRow;
  side: "CALL" | "PUT";
  maxOi: number;
  breakWall: number | null;
  spot: number;
}) {
  const color = () => (props.side === "CALL" ? palette.NEGATIVE : palette.POSITIVE);
  const totalPct = () => Math.min(100, (Math.max(0, props.row.oi) / props.maxOi) * 100);
  const newPct = () => Math.min(totalPct(), (Math.max(0, props.row.new_oi ?? 0) / props.maxOi) * 100);
  const oldPct = () => Math.max(0, totalPct() - newPct());
  const isBreak = () => props.breakWall != null && props.row.strike === props.breakWall;
  const ws = () => wallSide(props.row.strike, props.spot);
  const tag = () => wallCode(props.side === "CALL", ws(), false);
  return (
    <div
      data-testid={`walls-ladder-${props.side.toLowerCase()}-${props.row.strike}`}
      class="grid grid-cols-[78px_minmax(0,1fr)_62px_62px] gap-[8px] items-center px-[8px] py-[2px]"
      style={{
        display: "grid",
        "grid-template-columns": "78px minmax(0,1fr) 62px 62px",
        gap: `${REPORT_PAD.sm}px`,
        "align-items": "center",
        "padding-left": `${REPORT_PAD.sm}px`,
        "padding-right": `${REPORT_PAD.sm}px`,
        "padding-top": `${REPORT_PAD.xs}px`,
        "padding-bottom": `${REPORT_PAD.xs}px`,
        "min-height": `${REPORT_ROW.walls}px`,
        "border-left": props.row.tracked ? `2px solid ${color}` : "2px solid transparent",
        "background-color": props.row.tracked ? palette.SURFACE_ALT : "transparent",
        transition: "background-color 180ms ease",
      }}
    >
      <Text
        size="sm"
        span
        fw={props.row.tracked || isBreak() ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium}
        style={{
          "font-size": `${REPORT_FONT.sm}px`,
          "font-weight": props.row.tracked || isBreak() ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
          color: props.row.tracked ? color() : isBreak() ? palette.WARNING : palette.TEXT_COLOR,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
        }}
      >
        {fmtNum(props.row.strike)}
        <span style={{ "font-size": `${REPORT_FONT.micro}px`, "margin-left": "2px", color: palette.TEXT_MUTED }}>{tag()}</span>
        {isBreak() ? <span style={{ "font-size": `${REPORT_FONT.micro}px`, "margin-left": "2px", color: palette.NEGATIVE }}>BRK</span> : null}
      </Text>
      <div style={{ "height": "8px", "background-color": palette.SURFACE, position: "relative", "border-radius": "2px", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${totalPct()}%`, display: "flex", transition: "width 280ms cubic-bezier(.22,1,.36,1)" }}>
          <div style={{ width: `${oldPct()}%`, "background-color": alpha(color(), 0.22) }} />
          <div style={{ width: `${newPct()}%`, "background-color": color() }} />
        </div>
      </div>
      <Text
        size="sm"
        span
        style={{
          "font-size": `${REPORT_FONT.sm}px`,
          "text-align": "right",
          "font-variant-numeric": "tabular-nums",
          color: palette.TEXT_COLOR,
        }}
      >
        {fmtOI(props.row.oi)}
      </Text>
      <Text
        size="sm"
        span
        style={{
          "font-size": `${REPORT_FONT.sm}px`,
          "text-align": "right",
          "font-variant-numeric": "tabular-nums",
          color: erosionColor(props.row.new_oi),
        }}
      >
        {fmtSignedOI(props.row.new_oi)}
      </Text>
    </div>
  );
}

export function WallsLadder(props: { walls: WallsPayload }) {
  // Keep the top 3 by OI, but draw them on a monotonic strike axis so the
  // spot divider actually reads as a ladder (highest strike at the top).
  const calls = createMemo(() => [...props.walls.calls].slice(0, 3).sort((a, b) => b.strike - a.strike));
  const puts = createMemo(() => [...props.walls.puts].slice(0, 3).sort((a, b) => b.strike - a.strike));
  const maxOi = () => wallsMaxOi(calls(), puts());
  const breakWall = () => props.walls.alert?.wall ?? firstBreakEvent(props.walls.events ?? [])?.wall ?? null;
  return (
    <div data-testid="walls-ladder" class="min-w-0">
      <div class="items-center justify-between" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center", "justify-content": "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
          }}
        >
          WALL LADDER
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          calls above spot · puts below · bright = new OI
        </Text>
      </div>
      <div style={{ display: "grid", gap: `${REPORT_PAD.xs}px` }}>
        <For each={calls()}>{(row) => (
          <LadderRow row={row} side="CALL" maxOi={maxOi()} breakWall={breakWall()} spot={props.walls.spot} />
        )}</For>
        <div class="flex items-center gap-[8px]" style={{ "margin-top": `${REPORT_PAD.xs}px`, "margin-bottom": `${REPORT_PAD.xs}px`, "min-width": 0, display: "flex", "align-items": "center", "gap": "1px" }}>
          <div style={{ flex: 1, "border-top": `1px dashed ${palette.PRIMARY}` }} />
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              "font-size": `${REPORT_FONT.xs}px`,
              "font-weight": REPORT_FONT_WEIGHT.extrabold,
              color: palette.PRIMARY,
              "white-space": "nowrap",
            }}
          >
            SPOT {fmtNum(props.walls.spot, 2)}
          </Text>
          <Text
            size="xs"
            span
            style={{
              "font-size": `${REPORT_FONT.micro}px`,
              color: palette.TEXT_MUTED,
              "white-space": "nowrap",
            }}
          >
            MP {fmtNum(props.walls.max_pain)} · FLIP {fmtNum(props.walls.flip)}
          </Text>
        </div>
        <For each={puts()}>{(row) => (
          <LadderRow row={row} side="PUT" maxOi={maxOi()} breakWall={breakWall()} spot={props.walls.spot} />
        )}</For>
      </div>
    </div>
  );
}

export function WallsHistoryChart(props: { walls: WallsPayload }) {
  const callValues = () => props.walls.history.map((point) => point.call_oi ?? null);
  const putValues = () => props.walls.history.map((point) => point.put_oi ?? null);
  const mpValues = () => props.walls.history.map((point) => point.max_pain);
  const first = () => props.walls.history[0];
  const last = () => props.walls.history[props.walls.history.length - 1];
  return (
    <div data-testid="walls-history" class="min-w-0">
      <div class="items-center justify-between" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center", "justify-content": "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_COLOR,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
          }}
        >
          TRACKED WALL · {fmtNum(props.walls.call_wall.strike)} · LAST {props.walls.window_min}m
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          {first()?.t?.slice(11, 16)} → {last()?.t?.slice(11, 16)}
        </Text>
      </div>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", "gap": `${REPORT_PAD.md}px` }}>
        <div class="min-w-0">
          <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
            <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>call OI · 30m Δ</Text>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "font-weight": REPORT_FONT_WEIGHT.bold,
                color: erosionColor(props.walls.tracked_call_erosion_30m),
              }}
            >
              {fmtPct(props.walls.tracked_call_erosion_30m)}
            </Text>
          </div>
          <div>
            <Sparkline values={callValues()} width={560} height={44} color={palette.NEGATIVE} testId="walls-call-spark" animate />
          </div>
        </div>
        <div class="min-w-0">
          <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
            <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>put OI at the same strike · 30m Δ</Text>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "font-weight": REPORT_FONT_WEIGHT.bold,
                color: erosionColor(props.walls.tracked_put_build_30m),
              }}
            >
              {fmtPct(props.walls.tracked_put_build_30m)}
            </Text>
          </div>
          <div>
            <Sparkline values={putValues()} width={560} height={44} color={palette.POSITIVE} testId="walls-put-spark" animate />
          </div>
        </div>
      </div>
      <div style={{ "margin-top": `${REPORT_PAD.md}px` }}>
        <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>max pain · drift</Text>
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              "font-size": `${REPORT_FONT.sm}px`,
              "font-weight": REPORT_FONT_WEIGHT.bold,
              color: palette.PRIMARY,
            }}
          >
            {fmtNum(props.walls.max_pain_drift)}
          </Text>
        </div>
        <div>
          <Sparkline values={mpValues()} width={1160} height={24} color={palette.PRIMARY} testId="walls-maxpain-spark" animate />
        </div>
      </div>
    </div>
  );
}
