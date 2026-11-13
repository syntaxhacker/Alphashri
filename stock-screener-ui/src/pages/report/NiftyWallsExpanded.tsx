import { createEffect, createMemo, createSignal, For } from "solid-js";
import { Text, Button, Badge, Box, Divider } from "@/ui";
import { alpha } from "@/ui/alpha";
import { LocalPanelModal } from "./LocalPanelModal";
import { Sparkline } from "@/components/common/Sparkline";
import { WallsMapChart } from "./WallsMap";
import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload, WallsRow } from "@/api/reportNifty";
import {
  STATE_COLOR,
  dist,
  erosionColor,
  firstBreakEvent,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtSignedOI,
  formatDte,
  lastBreakEvent,
  newOiTint,
  wallsMaxOi,
} from "./niftyWallsFormat";
import { wallCode, wallSide } from "./niftyChartMath";
import {
  REPORT_FONT,
  REPORT_ROW,
  REPORT_PAD,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

function StatBar(props: { walls: WallsPayload }) {
  const cells = createMemo(() => [
    { label: "SPOT", value: fmtNum(props.walls.spot, 2) },
    { label: "MAX PAIN", value: fmtNum(props.walls.max_pain) },
    { label: "DRIFT", value: fmtNum(props.walls.max_pain_drift) },
    { label: "ATM", value: fmtNum(props.walls.atm) },
    {
      label: "PIN",
      value: `${props.walls.pin_distance_pts > 0 ? "+" : ""}${fmtNum(props.walls.pin_distance_pts, 0)} (${props.walls.pin_distance_pct.toFixed(2)}%)`,
      color: palette.PRIMARY,
    },
    { label: "GEX", value: props.walls.gex_degraded ? "n/a" : fmtNum(props.walls.net_gex, 1) },
    { label: "GEX FLIP", value: props.walls.gex_degraded ? "n/a" : fmtNum(props.walls.flip) },
  ]);
  return (
    <div
      class="grid grid-cols-[repeat(7,minmax(0,1fr))] border border-solid bg-surface-alt"
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
            "border-right": index < cells.length - 1 ? `1px solid ${palette.BORDER}` : "none",
          }}
        >
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              "font-size": REPORT_FONT.micro,
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
            className="tabular-nums whitespace-nowrap overflow-hidden truncate"
            style={{
              "font-size": REPORT_FONT.md,
              "line-height": REPORT_LINE_HEIGHT.snug,
              "font-weight": REPORT_FONT_WEIGHT.bold,
              color: cell.color ?? palette.TEXT_COLOR,
              "font-variant-numeric": "tabular-nums",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
            }}
          >
            {cell.value}
          </Text>
        </div>
      )}</For>
    </div>
  );
}

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
        "min-height": REPORT_ROW.walls,
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
          "font-size": REPORT_FONT.sm,
          "font-weight": props.row.tracked || isBreak() ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
          color: props.row.tracked ? color() : isBreak() ? palette.WARNING : palette.TEXT_COLOR,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
        }}
      >
        {fmtNum(props.row.strike)}
        <span style={{ "font-size": REPORT_FONT.micro, "margin-left": "2px", color: palette.TEXT_MUTED }}>{tag()}</span>
        {isBreak() ? <span style={{ "font-size": REPORT_FONT.micro, "margin-left": "2px", color: palette.NEGATIVE }}>BRK</span> : null}
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
          "font-size": REPORT_FONT.sm,
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
          "font-size": REPORT_FONT.sm,
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

function WallsLadder(props: { walls: WallsPayload }) {
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
            "font-size": REPORT_FONT.xs,
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
              "font-size": REPORT_FONT.xs,
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
              "font-size": REPORT_FONT.micro,
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

function ErosionBar(props: { value: number | null | undefined }) {
  if (props.value == null) return null;
  const width = Math.min(100, Math.abs(props.value) * 500);
  return (
    <div style={{ width: "100%", "height": "4px", "background-color": palette.SURFACE, overflow: "hidden" }}>
      <div
        style={{
          width: `${width}%`,
          height: "100%",
          "background-color": erosionColor(props.value),
          "margin-left": props.value < 0 ? "auto" : 0,
          transition: "width 280ms cubic-bezier(.22,1,.36,1)",
        }}
      />
    </div>
  );
}

function WallsTable(props: { title: string; side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = props.side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const maxOi = wallsMaxOi(props.rows);
  return (
    <div data-testid={`walls-table-${props.side.toLowerCase()}`} class="min-w-0">
      <div class="items-center" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": REPORT_FONT.xs,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
          }}
        >
          {props.title}
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>top {props.rows.length} by OI</Text>
      </div>
      <Box
        component="table"
        style={{
          width: "100%",
          "table-layout": "fixed",
          "border-collapse": "collapse",
          "font-size": REPORT_FONT.sm,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr style={{ color: palette.TEXT_MUTED, height: REPORT_ROW.walls }}>
            <th align="left" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Strike</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>OI</th>
            <th align="right" title="New OI since session open" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>NEW</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>5m</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>30m Δ</th>
            <th align="left" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>erosion</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>dist</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>{(row) => {
            const ws = wallSide(row.strike, props.spot);
            const tag = wallCode(props.side === "CALL", ws, false);
            return (
              <tr
                key={`${props.side}-${row.strike}`}
                style={{
                  background: row.tracked ? palette.SURFACE_ALT : "transparent",
                  "font-weight": row.tracked ? 700 : 400,
                  "border-top": `1px solid ${palette.BORDER}`,
                  height: REPORT_ROW.walls,
                  transition: "background-color 180ms ease",
                }}
              >
                <td
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    color: row.tracked ? color : palette.TEXT_COLOR,
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {fmtNum(row.strike)}
                  <span style={{ "font-size": REPORT_FONT.micro, "margin-left": "3px", color: palette.TEXT_MUTED }}>{tag}</span>
                  {row.tracked ? (
                    <span style={{ "font-size": REPORT_FONT.micro, "margin-left": "3px", color: palette.TEXT_MUTED }}>TRACKED</span>
                  ) : null}
                </td>
                <td
                  align="right"
                  title={`Old ${fmtOI(row.oi_open ?? 0)} → new ${fmtOI(row.oi)}`}
                  style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, position: "relative" }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      "left": "4px",
                      "right": "4px",
                      "bottom": "1px",
                      "height": "2px",
                      background: palette.SURFACE,
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${Math.min(100, (row.oi / maxOi) * 100)}%`,
                        height: "100%",
                        background: color,
                        opacity: 0.55,
                        transition: "width 280ms cubic-bezier(.22,1,.36,1)",
                      }}
                    />
                  </span>
                  {fmtOI(row.oi)}
                </td>
                <td
                  align="right"
                  title={`Old ${fmtOI(row.oi_open ?? 0)} → new ${fmtOI(row.oi)} · ${fmtPct(row.new_oi_pct)} of old book`}
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    color: erosionColor(row.new_oi),
                    "background-color": newOiTint(row.new_oi, props.rows),
                    transition: "background-color 220ms ease",
                  }}
                >
                  {fmtSignedOI(row.new_oi)}
                </td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: erosionColor(row.erosion_5m) }}>{fmtPct(row.erosion_5m)}</td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: erosionColor(row.erosion_30m) }}>{fmtPct(row.erosion_30m)}</td>
                <td style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}><ErosionBar value={row.erosion_30m} /></td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: palette.TEXT_MUTED }}>{dist(row.distance_pct)}</td>
              </tr>
            );
          }}</For>
        </tbody>
      </Box>
    </div>
  );
}

function HistoryChart(props: { walls: WallsPayload }) {
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
            "font-size": REPORT_FONT.xs,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_COLOR,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
          }}
        >
          TRACKED WALL · {fmtNum(props.walls.call_wall.strike)} · LAST {props.walls.window_min}m
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          {first?.t?.slice(11, 16)} → {last?.t?.slice(11, 16)}
        </Text>
      </div>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", "gap": "1.5px" }}>
        <div class="min-w-0">
          <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
            <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>call OI · 30m Δ</Text>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": REPORT_FONT.sm,
                "font-weight": REPORT_FONT_WEIGHT.bold,
                color: erosionColor(props.walls.tracked_call_erosion_30m),
              }}
            >
              {fmtPct(props.walls.tracked_call_erosion_30m)}
            </Text>
          </div>
          <div style={{ "& svg": { width: "100%", "height": "44px" } }}>
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
                "font-size": REPORT_FONT.sm,
                "font-weight": REPORT_FONT_WEIGHT.bold,
                color: erosionColor(props.walls.tracked_put_build_30m),
              }}
            >
              {fmtPct(props.walls.tracked_put_build_30m)}
            </Text>
          </div>
          <div style={{ "& svg": { width: "100%", "height": "44px" } }}>
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
              "font-size": REPORT_FONT.sm,
              "font-weight": REPORT_FONT_WEIGHT.bold,
              color: palette.PRIMARY,
            }}
          >
            {fmtNum(props.walls.max_pain_drift)}
          </Text>
        </div>
        <div style={{ "& svg": { width: "100%", "height": "24px" } }}>
          <Sparkline values={mpValues()} width={1160} height={24} color={palette.PRIMARY} testId="walls-maxpain-spark" animate />
        </div>
      </div>
    </div>
  );
}

function SequenceTable(props: { events: WallsEvent[] }) {
  const recent = () => props.events.slice(-10);
  const hidden = () => props.events.length - recent().length;
  const firstBreakAt = () => firstBreakEvent(props.events)?.at;
  return (
    <div data-testid="walls-events" class="min-w-0">
      <div class="items-center justify-between" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center", "justify-content": "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": REPORT_FONT.xs,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
          }}
        >
          SEQUENCE · {props.events.length} events
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>touch → break · last 10</Text>
      </div>
      <Box
        component="table"
        style={{
          width: "100%",
          "table-layout": "fixed",
          "border-collapse": "collapse",
          "font-size": REPORT_FONT.sm,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        <colgroup>
          <col style={{ width: "11%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
        </colgroup>
        <thead>
          <tr style={{ color: palette.TEXT_MUTED, height: REPORT_ROW.walls }}>
            <th align="left" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Time</th>
            <th align="left" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Event</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Wall</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Call Δ30m</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Put Δ30m</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Spot</th>
            <th align="right" style={{ "font-weight": 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Max pain</th>
          </tr>
        </thead>
        <tbody>
          <For each={recent()}>{(event) => {
            const isBreak = event.kind === "BREAK";
            const isFirst = isBreak && event.at === firstBreakAt();
            return (
              <tr
                style={{
                  background: isBreak ? palette.SURFACE_ALT : "transparent",
                  "border-top": `1px solid ${palette.BORDER}`,
                  height: REPORT_ROW.walls,
                }}
              >
                <td style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: palette.TEXT_MUTED }}>{event.at.slice(11, 19)}</td>
                <td
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    "font-weight": isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
                    color: isBreak ? palette.NEGATIVE : palette.WARNING,
                  }}
                >
                  {isBreak ? (isFirst ? "FIRST BREAK" : "RE-BREAK") : "TOUCH"}
                </td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>{fmtNum(event.wall)}</td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: erosionColor(event.erosion_30m) }}>
                  {fmtPct(event.erosion_30m)}
                </td>
                <td
                  align="right"
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    color: (event.put_build_30m ?? 0) > 0 ? palette.POSITIVE : palette.TEXT_MUTED,
                  }}
                >
                  {fmtPct(event.put_build_30m)}
                </td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>{fmtNum(event.spot, 1)}</td>
                <td align="right" style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: palette.TEXT_MUTED }}>{fmtNum(event.max_pain)}</td>
              </tr>
            );
          }}</For>
        </tbody>
      </Box>
      {hidden > 0 && (
        <Text
          size="xs"
          span
          style={{
            "font-size": REPORT_FONT.micro,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          +{hidden} earlier events in the recorded window
        </Text>
      )}
    </div>
  );
}

export function NiftyWallsExpanded(props: {
  open: boolean;
  walls: WallsPayload | null;
  onClose: () => void;
  onReplayBreak?: (at: string) => void;
}) {
  const open = () => props.open;
  const walls = () => props.walls;
  const stateColor = () => (walls() ? STATE_COLOR[walls()!.state] ?? palette.TEXT_MUTED : palette.TEXT_MUTED);
  const dteLabel = () => (walls() ? formatDte(walls()!.dte) : null);
  const [view, setView] = createSignal<"MAP" | "DATA">(walls()?.wall_map ? "MAP" : "DATA");
  let userChoseView = false;
  const activeView = () => (walls()?.wall_map ? view() : "DATA");

  createEffect(() => {
    if (walls()?.wall_map && !userChoseView) setView("MAP");
  });

  const chooseView = (mode: "MAP" | "DATA") => {
    userChoseView = true;
    setView(mode);
  };
  const alert = () => walls()?.alert ?? null;
  const gaps = () => walls()?.freshness.gaps ?? [];
  const events = () => walls()?.events ?? [];
  const firstBreak = () => firstBreakEvent(events()) ?? null;
  const lastBreak = () => lastBreakEvent(events()) ?? null;
  const primaryBreak = () => alert() ?? firstBreak() ?? lastBreak();

  return (
    <LocalPanelModal
      open={open()}
      onClose={() => props.onClose()}
      maxWidth={1240}
      autoHeight
      max-height="92vh"
      title={
        <div spacing={1} class="flex-wrap" style={{ "flex-wrap": "wrap", "row-gap": "4px", "align-items": "center" }}>
          <Text
            size="lg"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              "font-size": REPORT_FONT.lg,
              "font-weight": REPORT_FONT_WEIGHT.extrabold,
              "letter-spacing": REPORT_LETTER_SPACING.wider,
            }}
          >
            WALLS · {walls()!.symbol}
          </Text>
          <Badge
            size="xs"
            variant="outline"
            color={stateColor()}
            style={{
              "height": "20px",
              "font-size": REPORT_FONT.xs,
              "font-weight": REPORT_FONT_WEIGHT.extrabold,
              color: stateColor(),
              "background-color": "transparent",
              border: `1px solid ${stateColor()}`,
              "padding-left": `${REPORT_PAD.sm}px`,
              "padding-right": `${REPORT_PAD.sm}px`,
            }}
          >
            {walls()!.state.replace("_", " ")}
          </Badge>
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
            {dteLabel()} · {walls()!.expiry ?? "—"} · {walls()!.freshness.rows} rows
          </Text>
        </div>
      }
    >
      <div class="flex flex-col gap-[8px]" style={{ padding: `${REPORT_PAD.sm}px`, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.sm}px` }}>
        <StatBar walls={walls()!} />

        <div class="items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between", gap: `${REPORT_PAD.sm}px` }}>
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              "font-size": REPORT_FONT.micro,
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
                key={mode}
                size="xs"
                aria-pressed={activeView() === mode}
                disabled={mode === "MAP" && !walls()!.wall_map}
                onClick={() => chooseView(mode)}
                className="min-w-0"
                style={{
                  "min-width": 0,
                  "padding-left": `${REPORT_PAD.sm}px`,
                  "padding-right": `${REPORT_PAD.sm}px`,
                  "padding-top": "4px",
                  "padding-bottom": "4px",
                  "font-size": REPORT_FONT.xs,
                  "font-weight": REPORT_FONT_WEIGHT.extrabold,
                  "line-height": 1.4,
                  color: activeView() === mode ? palette.TEXT_COLOR : palette.TEXT_MUTED,
                  "background-color": activeView() === mode ? palette.SURFACE_ALT : "transparent",
                  border: `1px solid ${activeView() === mode ? palette.BORDER : "transparent"}`,
                  "border-radius": "2px",
                }}
              >
                {mode}
              </Button>
            )}</For>
          </div>
        </div>

        {activeView() === "MAP" && walls()!.wall_map ? (
          <WallsMapChart
            map={walls()!.wall_map}
            events={events()}
            callWall={walls()!.call_wall.strike}
            putWall={walls()!.put_wall.strike}
            maxPain={walls()!.max_pain}
            regime={walls()!.regime}
          />
        ) : (
          <>
            <WallsLadder walls={walls()!} />

            <div style={{ display: "grid", "grid-template-columns": { xs: "1fr", md: "1fr 1fr" }, "gap": "1px" }}>
              <WallsTable title="CALL WALLS" side="CALL" rows={walls()!.calls} spot={walls()!.spot} />
              <WallsTable title="PUT WALLS" side="PUT" rows={walls()!.puts} spot={walls()!.spot} />
            </div>

            <HistoryChart walls={walls()!} />
          </>
        )}

        <Divider style={{ "border-color": palette.BORDER }} />

        <SequenceTable events={events()} />

        <Divider style={{ "border-color": palette.BORDER }} />

        <div style={{ display: "grid", "grid-template-columns": { xs: "1fr", md: "1.4fr 1fr" }, "gap": "1px" }}>
          <div>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": REPORT_FONT.xs,
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
                "font-size": REPORT_FONT.sm,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_COLOR,
              }}
            >
              {walls()!.read ||
                (walls()!.expiry_day
                  ? "0-DTE: the walls sit at the spot. A break needs the call wall to erode, the put floor to build, and max pain to drift — the 14:25 gamma leg, not the 14:04 touch."
                  : "Non-expiry: wall erosion is positioning. The violent 0-DTE gamma/pin does not apply; watch the wall as a level, not a pin.")}
            </Text>
            <div class="flex-wrap" style={{ "flex-wrap": "wrap", "row-gap": "4px", "margin-top": `${REPORT_PAD.md}px` }}>
              <For each={walls()!.reasons}>{(reason) => (
                <Badge
                  key={reason}
                  size="xs"
                  variant="light"
                  color="default"
                  className="min-w-0"
                  style={{
                    "height": "19px",
                    "font-size": REPORT_FONT.xs,
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
                "font-size": REPORT_FONT.xs,
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
                    "font-size": REPORT_FONT.md,
                    "font-weight": REPORT_FONT_WEIGHT.extrabold,
                    color: palette.NEGATIVE,
                  }}
                >
                  {alert()
                    ? `${fmtNum(alert()!.wall)} gave way · ${fmtNum(alert()!.spot, 1)}`
                    : `First break ${fmtNum(primaryBreak()!.wall)} · ${fmtNum(primaryBreak()!.spot, 1)}`}
                </Text>
                <Text
                  size="xs"
                  span
                  style={{
                    "font-size": REPORT_FONT.sm,
                    "line-height": REPORT_LINE_HEIGHT.relaxed,
                    color: palette.TEXT_MUTED,
                  }}
                >
                  {primaryBreak()!.at.slice(11, 19)} · call wall {fmtPct(primaryBreak()!.erosion_30m)} · put build {fmtPct(primaryBreak()!.put_build_30m)} · max pain {fmtNum(primaryBreak()!.max_pain)}
                </Text>
                {lastBreak() && lastBreak()!.at !== primaryBreak()!.at && (
                  <Text
                    size="xs"
                    span
                    style={{
                      "font-size": REPORT_FONT.xs,
                      "line-height": REPORT_LINE_HEIGHT.relaxed,
                      color: palette.WARNING,
                    }}
                  >
                    Re-broke {lastBreak()!.at.slice(11, 19)} · call {fmtPct(lastBreak()!.erosion_30m)} · put {fmtPct(lastBreak()!.put_build_30m)}
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
                    "font-size": REPORT_FONT.xs,
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
                "font-size": REPORT_FONT.xs,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
                "margin-top": `${REPORT_PAD.md}px`,
              }}
            >
              Freshness: last {walls()!.freshness.last_t.slice(11, 19)} · age {Math.round(walls()!.freshness.age_sec)}s ·
              {walls()!.freshness.stale ? "STALE" : "fresh"}
              {gaps().length > 0
                ? ` · last gap ${gaps()[gaps().length - 1].from.slice(11, 16)}→${gaps()[gaps().length - 1].to.slice(11, 16)} (${Math.round(gaps()[gaps().length - 1].seconds)}s)`
                : ""}
            </Text>
          </div>
        </div>

        <Text
          size="xs"
          span
          style={{
            "font-size": REPORT_FONT.micro,
            color: palette.TEXT_MUTED,
          }}
        >
          Heuristic positioning read — not advice. The tape is 1-minute; chain10s is 10s. The morning is only present if the recorder ran.
        </Text>
      </div>
    </LocalPanelModal>
  );
}
