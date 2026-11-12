import { memo, useEffect, useRef, useState } from "react";
import { Box, Stack, Text, Button, Badge, Divider } from "@/ui";
import { alpha } from "@/ui/alpha";
import { PanelModal } from "@/components/common/PanelModal";
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

function StatBar({ walls }: { walls: WallsPayload }) {
  const cells = [
    { label: "SPOT", value: fmtNum(walls.spot, 2) },
    { label: "MAX PAIN", value: fmtNum(walls.max_pain) },
    { label: "DRIFT", value: fmtNum(walls.max_pain_drift) },
    { label: "ATM", value: fmtNum(walls.atm) },
    {
      label: "PIN",
      value: `${walls.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls.pin_distance_pts, 0)} (${walls.pin_distance_pct.toFixed(2)}%)`,
      color: palette.PRIMARY,
    },
    { label: "GEX", value: walls.gex_degraded ? "n/a" : fmtNum(walls.net_gex, 1) },
    { label: "GEX FLIP", value: walls.gex_degraded ? "n/a" : fmtNum(walls.flip) },
  ];
  return (
    <Box
      className="grid grid-cols-[repeat(7,minmax(0,1fr))] border border-solid bg-surface-alt"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0,1fr))",
        border: `1px solid ${palette.BORDER}`,
        backgroundColor: palette.SURFACE_ALT,
      }}
    >
      {cells.map((cell, index) => (
        <Box
          key={cell.label}
          style={{
            paddingLeft: `${REPORT_PAD.sm}px`,
            paddingRight: `${REPORT_PAD.sm}px`,
            paddingTop: `${REPORT_PAD.xs}px`,
            paddingBottom: `${REPORT_PAD.xs}px`,
            minWidth: 0,
            borderRight: index < cells.length - 1 ? `1px solid ${palette.BORDER}` : "none",
          }}
        >
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              fontSize: REPORT_FONT.micro,
              lineHeight: REPORT_LINE_HEIGHT.tight,
              color: palette.TEXT_MUTED,
              letterSpacing: REPORT_LETTER_SPACING.wide,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
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
              fontSize: REPORT_FONT.md,
              lineHeight: REPORT_LINE_HEIGHT.snug,
              fontWeight: REPORT_FONT_WEIGHT.bold,
              color: cell.color ?? palette.TEXT_COLOR,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {cell.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function LadderRow({
  row,
  side,
  maxOi,
  breakWall,
  spot,
}: {
  row: WallsRow;
  side: "CALL" | "PUT";
  maxOi: number;
  breakWall: number | null;
  spot: number;
}) {
  const color = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const totalPct = Math.min(100, (Math.max(0, row.oi) / maxOi) * 100);
  const newPct = Math.min(totalPct, (Math.max(0, row.new_oi ?? 0) / maxOi) * 100);
  const oldPct = Math.max(0, totalPct - newPct);
  const isBreak = breakWall != null && row.strike === breakWall;
  const ws = wallSide(row.strike, spot);
  const tag = wallCode(side === "CALL", ws, false);
  return (
    <Box
      data-testid={`walls-ladder-${side.toLowerCase()}-${row.strike}`}
      className="grid grid-cols-[78px_minmax(0,1fr)_62px_62px] gap-[8px] items-center px-[8px] py-[2px]"
      style={{
        display: "grid",
        gridTemplateColumns: "78px minmax(0,1fr) 62px 62px",
        gap: `${REPORT_PAD.sm}px`,
        alignItems: "center",
        paddingLeft: `${REPORT_PAD.sm}px`,
        paddingRight: `${REPORT_PAD.sm}px`,
        paddingTop: `${REPORT_PAD.xs}px`,
        paddingBottom: `${REPORT_PAD.xs}px`,
        minHeight: REPORT_ROW.walls,
        borderLeft: row.tracked ? `2px solid ${color}` : "2px solid transparent",
        backgroundColor: row.tracked ? palette.SURFACE_ALT : "transparent",
        transition: "background-color 180ms ease",
      }}
    >
      <Text
        size="sm"
        span
        fw={row.tracked || isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium}
        style={{
          fontSize: REPORT_FONT.sm,
          fontWeight: row.tracked || isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
          color: row.tracked ? color : isBreak ? palette.WARNING : palette.TEXT_COLOR,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {fmtNum(row.strike)}
        <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 2, color: palette.TEXT_MUTED }}>{tag}</span>
        {isBreak ? <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 2, color: palette.NEGATIVE }}>BRK</span> : null}
      </Text>
      <Box style={{ height: 8, backgroundColor: palette.SURFACE, position: "relative", borderRadius: "2px", overflow: "hidden" }}>
        <Box style={{ position: "absolute", inset: 0, width: `${totalPct}%`, display: "flex", transition: "width 280ms cubic-bezier(.22,1,.36,1)" }}>
          <Box style={{ width: `${oldPct}%`, backgroundColor: alpha(color, 0.22) }} />
          <Box style={{ width: `${newPct}%`, backgroundColor: color }} />
        </Box>
      </Box>
      <Text
        size="sm"
        span
        style={{
          fontSize: REPORT_FONT.sm,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: palette.TEXT_COLOR,
        }}
      >
        {fmtOI(row.oi)}
      </Text>
      <Text
        size="sm"
        span
        style={{
          fontSize: REPORT_FONT.sm,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: erosionColor(row.new_oi),
        }}
      >
        {fmtSignedOI(row.new_oi)}
      </Text>
    </Box>
  );
}

function WallsLadder({ walls }: { walls: WallsPayload }) {
  // Keep the top 3 by OI, but draw them on a monotonic strike axis so the
  // spot divider actually reads as a ladder (highest strike at the top).
  const calls = [...walls.calls].slice(0, 3).sort((a, b) => b.strike - a.strike);
  const puts = [...walls.puts].slice(0, 3).sort((a, b) => b.strike - a.strike);
  const maxOi = wallsMaxOi(calls, puts);
  const breakWall = walls.alert?.wall ?? firstBreakEvent(walls.events ?? [])?.wall ?? null;
  return (
    <Box data-testid="walls-ladder" className="min-w-0">
      <Stack direction="row" className="items-center justify-between" style={{ marginBottom: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            letterSpacing: REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
          }}
        >
          WALL LADDER
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          calls above spot · puts below · bright = new OI
        </Text>
      </Stack>
      <Box style={{ display: "grid", gap: `${REPORT_PAD.xs}px` }}>
        {calls.map((row) => (
          <LadderRow key={`ladder-call-${row.strike}`} row={row} side="CALL" maxOi={maxOi} breakWall={breakWall} spot={walls.spot} />
        ))}
        <Box className="flex items-center gap-[8px]" style={{ marginTop: `${REPORT_PAD.xs}px`, marginBottom: `${REPORT_PAD.xs}px`, minWidth: 0, display: "flex", alignItems: "center", gap: 1 }}>
          <Box style={{ flex: 1, borderTop: `1px dashed ${palette.PRIMARY}` }} />
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              fontSize: REPORT_FONT.xs,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
              color: palette.PRIMARY,
              whiteSpace: "nowrap",
            }}
          >
            SPOT {fmtNum(walls.spot, 2)}
          </Text>
          <Text
            size="xs"
            span
            style={{
              fontSize: REPORT_FONT.micro,
              color: palette.TEXT_MUTED,
              whiteSpace: "nowrap",
            }}
          >
            MP {fmtNum(walls.max_pain)} · FLIP {fmtNum(walls.flip)}
          </Text>
        </Box>
        {puts.map((row) => (
          <LadderRow key={`ladder-put-${row.strike}`} row={row} side="PUT" maxOi={maxOi} breakWall={breakWall} spot={walls.spot} />
        ))}
      </Box>
    </Box>
  );
}

function ErosionBar({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const width = Math.min(100, Math.abs(value) * 500);
  return (
    <Box style={{ width: "100%", height: 4, backgroundColor: palette.SURFACE, overflow: "hidden" }}>
      <Box
        style={{
          width: `${width}%`,
          height: "100%",
          backgroundColor: erosionColor(value),
          marginLeft: value < 0 ? "auto" : 0,
          transition: "width 280ms cubic-bezier(.22,1,.36,1)",
        }}
      />
    </Box>
  );
}

function WallsTable({ title, side, rows, spot }: { title: string; side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const mostEroded = rows.reduce<WallsRow | null>((best, row) => {
    if (row.erosion_30m == null) return best;
    if (!best || best.erosion_30m == null) return row;
    return row.erosion_30m < best.erosion_30m ? row : best;
  }, null);
  const leader = mostEroded && (mostEroded.erosion_30m ?? 0) < 0 ? mostEroded : null;
  const maxOi = wallsMaxOi(rows);
  return (
    <Box data-testid={`walls-table-${side.toLowerCase()}`} className="min-w-0">
      <Stack direction="row" spacing={0.5} className="items-center" style={{ marginBottom: `${REPORT_PAD.sm}px`, alignItems: "center" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color,
            letterSpacing: REPORT_LETTER_SPACING.wide,
          }}
        >
          {title}
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>top {rows.length} by OI</Text>
      </Stack>
      <Box
        component="table"
        style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "collapse",
          fontSize: REPORT_FONT.sm,
          fontVariantNumeric: "tabular-nums",
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
            <th align="left" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Strike</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>OI</th>
            <th align="right" title="New OI since session open" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>NEW</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>5m</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>30m Δ</th>
            <th align="left" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>erosion</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>dist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ws = wallSide(row.strike, spot);
            const tag = wallCode(side === "CALL", ws, false);
            return (
              <tr
                key={`${side}-${row.strike}`}
                style={{
                  background: row.tracked ? palette.SURFACE_ALT : "transparent",
                  fontWeight: row.tracked ? 700 : 400,
                  borderTop: `1px solid ${palette.BORDER}`,
                  height: REPORT_ROW.walls,
                  transition: "background-color 180ms ease",
                }}
              >
                <td
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    color: row.tracked ? color : palette.TEXT_COLOR,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtNum(row.strike)}
                  <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 3, color: palette.TEXT_MUTED }}>{tag}</span>
                  {row.tracked ? (
                    <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 3, color: palette.TEXT_MUTED }}>TRACKED</span>
                  ) : null}
                  {leader?.strike === row.strike ? (
                    <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 3, color: palette.WARNING }}>MOST ERODED</span>
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
                      left: 4,
                      right: 4,
                      bottom: 1,
                      height: 2,
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
                    backgroundColor: newOiTint(row.new_oi, rows),
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
          })}
        </tbody>
      </Box>
    </Box>
  );
}

function HistoryChart({ walls }: { walls: WallsPayload }) {
  const callValues = walls.history.map((point) => point.call_oi ?? null);
  const putValues = walls.history.map((point) => point.put_oi ?? null);
  const mpValues = walls.history.map((point) => point.max_pain);
  const first = walls.history[0];
  const last = walls.history[walls.history.length - 1];
  return (
    <Box data-testid="walls-history" className="min-w-0">
      <Stack direction="row" className="items-center justify-between" style={{ marginBottom: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_COLOR,
            letterSpacing: REPORT_LETTER_SPACING.wide,
          }}
        >
          TRACKED WALL · {fmtNum(walls.call_wall.strike)} · LAST {walls.window_min}m
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          {first?.t?.slice(11, 16)} → {last?.t?.slice(11, 16)}
        </Text>
      </Stack>
      <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        <Box className="min-w-0">
          <Stack direction="row" className="items-center justify-between" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>call OI · 30m Δ</Text>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                fontSize: REPORT_FONT.sm,
                fontWeight: REPORT_FONT_WEIGHT.bold,
                color: erosionColor(walls.tracked_call_erosion_30m),
              }}
            >
              {fmtPct(walls.tracked_call_erosion_30m)}
            </Text>
          </Stack>
          <Box style={{ "& svg": { width: "100%", height: 44 } }}>
            <Sparkline values={callValues} width={560} height={44} color={palette.NEGATIVE} testId="walls-call-spark" animate />
          </Box>
        </Box>
        <Box className="min-w-0">
          <Stack direction="row" className="items-center justify-between" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>put OI at the same strike · 30m Δ</Text>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                fontSize: REPORT_FONT.sm,
                fontWeight: REPORT_FONT_WEIGHT.bold,
                color: erosionColor(walls.tracked_put_build_30m),
              }}
            >
              {fmtPct(walls.tracked_put_build_30m)}
            </Text>
          </Stack>
          <Box style={{ "& svg": { width: "100%", height: 44 } }}>
            <Sparkline values={putValues} width={560} height={44} color={palette.POSITIVE} testId="walls-put-spark" animate />
          </Box>
        </Box>
      </Box>
      <Box style={{ marginTop: `${REPORT_PAD.md}px` }}>
        <Stack direction="row" className="items-center justify-between" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>max pain · drift</Text>
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              fontSize: REPORT_FONT.sm,
              fontWeight: REPORT_FONT_WEIGHT.bold,
              color: palette.PRIMARY,
            }}
          >
            {fmtNum(walls.max_pain_drift)}
          </Text>
        </Stack>
        <Box style={{ "& svg": { width: "100%", height: 24 } }}>
          <Sparkline values={mpValues} width={1160} height={24} color={palette.PRIMARY} testId="walls-maxpain-spark" animate />
        </Box>
      </Box>
    </Box>
  );
}

function SequenceTable({ events }: { events: WallsEvent[] }) {
  const recent = events.slice(-10);
  const hidden = events.length - recent.length;
  const firstBreakAt = firstBreakEvent(events)?.at;
  return (
    <Box data-testid="walls-events" className="min-w-0">
      <Stack direction="row" className="items-center justify-between" style={{ marginBottom: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            letterSpacing: REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
          }}
        >
          SEQUENCE · {events.length} events
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>touch → break · last 10</Text>
      </Stack>
      <Box
        component="table"
        style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "collapse",
          fontSize: REPORT_FONT.sm,
          fontVariantNumeric: "tabular-nums",
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
            <th align="left" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Time</th>
            <th align="left" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Event</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Wall</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Call Δ30m</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Put Δ30m</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Spot</th>
            <th align="right" style={{ fontWeight: 500, padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px` }}>Max pain</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((event, index) => {
            const isBreak = event.kind === "BREAK";
            const isFirst = isBreak && event.at === firstBreakAt;
            return (
              <tr
                key={`${event.at}-${index}`}
                style={{
                  background: isBreak ? palette.SURFACE_ALT : "transparent",
                  borderTop: `1px solid ${palette.BORDER}`,
                  height: REPORT_ROW.walls,
                }}
              >
                <td style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, color: palette.TEXT_MUTED }}>{event.at.slice(11, 19)}</td>
                <td
                  style={{
                    padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`,
                    fontWeight: isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
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
          })}
        </tbody>
      </Box>
      {hidden > 0 && (
        <Text
          size="xs"
          span
          style={{
            fontSize: REPORT_FONT.micro,
            color: palette.TEXT_MUTED,
            marginTop: `${REPORT_PAD.sm}px`,
          }}
        >
          +{hidden} earlier events in the recorded window
        </Text>
      )}
    </Box>
  );
}

export function NiftyWallsExpandedInner({
  open,
  walls,
  onClose,
  onReplayBreak,
}: {
  open: boolean;
  walls: WallsPayload | null;
  onClose: () => void;
  onReplayBreak?: (at: string) => void;
}) {
  if (!walls) return null;
  return (
    <NiftyWallsExpandedBody
      open={open}
      walls={walls}
      onClose={onClose}
      onReplayBreak={onReplayBreak}
    />
  );
}

/** Memoised: `walls` + the two callbacks are stable across the parent's
 *  ~1 s spot-tick renders. */
export const NiftyWallsExpanded = memo(NiftyWallsExpandedInner);
NiftyWallsExpanded.displayName = "NiftyWallsExpanded";

function NiftyWallsExpandedBody({
  open,
  walls,
  onClose,
  onReplayBreak,
}: {
  open: boolean;
  walls: WallsPayload;
  onClose: () => void;
  onReplayBreak?: (at: string) => void;
}) {
  const [view, setView] = useState<"MAP" | "DATA">(walls.wall_map ? "MAP" : "DATA");
  const userChoseView = useRef(false);
  const activeView = walls.wall_map ? view : "DATA";

  useEffect(() => {
    if (walls.wall_map && !userChoseView.current) setView("MAP");
  }, [walls.wall_map]);

  const chooseView = (mode: "MAP" | "DATA") => {
    userChoseView.current = true;
    setView(mode);
  };
  const stateColor = STATE_COLOR[walls.state] ?? palette.TEXT_MUTED;
  const dteLabel = formatDte(walls.dte);
  const alert = walls.alert;
  const gaps = walls.freshness.gaps;
  const events = walls.events ?? [];
  const firstBreak = firstBreakEvent(events) ?? null;
  const lastBreak = lastBreakEvent(events) ?? null;
  const primaryBreak = alert ?? firstBreak ?? lastBreak;

  return (
    <PanelModal
      open={open}
      onClose={onClose}
      max-width={1240}
      autoHeight
      max-height="92vh"
      title={
        <Stack direction="row" spacing={1} className="flex-wrap" style={{ flexWrap: "wrap", rowGap: 4, alignItems: "center" }}>
          <Text
            size="lg"
            span
            fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              fontSize: REPORT_FONT.lg,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
              letterSpacing: REPORT_LETTER_SPACING.wider,
            }}
          >
            WALLS · {walls.symbol}
          </Text>
          <Badge
            size="xs"
            variant="outline"
            color={stateColor}
            style={{
              height: 20,
              fontSize: REPORT_FONT.xs,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
              color: stateColor,
              backgroundColor: "transparent",
              border: `1px solid ${stateColor}`,
              paddingLeft: `${REPORT_PAD.sm}px`,
              paddingRight: `${REPORT_PAD.sm}px`,
            }}
          >
            {walls.state.replace("_", " ")}
          </Badge>
          <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
            {dteLabel} · {walls.expiry ?? "—"} · {walls.freshness.rows} rows
          </Text>
        </Stack>
      }
    >
      <Box className="flex flex-col gap-[8px]" style={{ padding: `${REPORT_PAD.sm}px`, display: "flex", flexDirection: "column", gap: `${REPORT_PAD.sm}px` }}>
        <StatBar walls={walls} />

        <Stack direction="row" className="items-center justify-between" style={{ alignItems: "center", justifyContent: "space-between", gap: `${REPORT_PAD.sm}px` }}>
          <Text
            size="xs"
            span
            fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
            style={{
              fontSize: REPORT_FONT.micro,
              fontWeight: REPORT_FONT_WEIGHT.bold,
              letterSpacing: REPORT_LETTER_SPACING.wide,
              color: palette.TEXT_MUTED,
            }}
          >
            VIEW
          </Text>
          <Stack direction="row" spacing={0.4}>
            {(["MAP", "DATA"] as const).map((mode) => (
              <Button
                key={mode}
                size="xs"
                aria-pressed={activeView === mode}
                disabled={mode === "MAP" && !walls.wall_map}
                onClick={() => chooseView(mode)}
                className="min-w-0"
                style={{
                  minWidth: 0,
                  paddingLeft: `${REPORT_PAD.sm}px`,
                  paddingRight: `${REPORT_PAD.sm}px`,
                  paddingTop: "4px",
                  paddingBottom: "4px",
                  fontSize: REPORT_FONT.xs,
                  fontWeight: REPORT_FONT_WEIGHT.extrabold,
                  lineHeight: 1.4,
                  color: activeView === mode ? palette.TEXT_COLOR : palette.TEXT_MUTED,
                  backgroundColor: activeView === mode ? palette.SURFACE_ALT : "transparent",
                  border: `1px solid ${activeView === mode ? palette.BORDER : "transparent"}`,
                  borderRadius: "2px",
                }}
              >
                {mode}
              </Button>
            ))}
          </Stack>
        </Stack>

        {activeView === "MAP" && walls.wall_map ? (
          <WallsMapChart
            map={walls.wall_map}
            events={events}
            callWall={walls.call_wall.strike}
            putWall={walls.put_wall.strike}
            maxPain={walls.max_pain}
            regime={walls.regime}
          />
        ) : (
          <>
            <WallsLadder walls={walls} />

            <Box style={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
              <WallsTable title="CALL WALLS" side="CALL" rows={walls.calls} spot={walls.spot} />
              <WallsTable title="PUT WALLS" side="PUT" rows={walls.puts} spot={walls.spot} />
            </Box>

            <HistoryChart walls={walls} />
          </>
        )}

        <Divider style={{ borderColor: palette.BORDER }} />

        <SequenceTable events={events} />

        <Divider style={{ borderColor: palette.BORDER }} />

        <Box style={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" }, gap: 1 }}>
          <Box>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                fontSize: REPORT_FONT.xs,
                fontWeight: REPORT_FONT_WEIGHT.extrabold,
                letterSpacing: REPORT_LETTER_SPACING.wide,
                color: palette.TEXT_COLOR,
                marginBottom: `${REPORT_PAD.sm}px`,
              }}
            >
              READ
            </Text>
            <Text
              data-testid="walls-read"
              size="sm"
              span
              style={{
                fontSize: REPORT_FONT.sm,
                lineHeight: REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_COLOR,
              }}
            >
              {walls.read ||
                (walls.expiry_day
                  ? "0-DTE: the walls sit at the spot. A break needs the call wall to erode, the put floor to build, and max pain to drift — the 14:25 gamma leg, not the 14:04 touch."
                  : "Non-expiry: wall erosion is positioning. The violent 0-DTE gamma/pin does not apply; watch the wall as a level, not a pin.")}
            </Text>
            <Stack direction="row" spacing={0.5} className="flex-wrap" style={{ flexWrap: "wrap", rowGap: 4, marginTop: `${REPORT_PAD.md}px` }}>
              {walls.reasons.map((reason) => (
                <Badge
                  key={reason}
                  size="xs"
                  variant="light"
                  color="default"
                  className="min-w-0"
                  style={{
                    height: 19,
                    fontSize: REPORT_FONT.xs,
                    color: palette.TEXT_MUTED,
                    backgroundColor: palette.SURFACE_ALT,
                    paddingLeft: `${REPORT_PAD.sm}px`,
                    paddingRight: `${REPORT_PAD.sm}px`,
                  }}
                >
                  {reason}
                </Badge>
              ))}
            </Stack>
          </Box>
          <Box>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                fontSize: REPORT_FONT.xs,
                fontWeight: REPORT_FONT_WEIGHT.extrabold,
                letterSpacing: REPORT_LETTER_SPACING.wide,
                color: palette.TEXT_COLOR,
                marginBottom: `${REPORT_PAD.sm}px`,
              }}
            >
              BREAK
            </Text>
            {primaryBreak ? (
              <Box data-testid="walls-break" style={{ borderLeft: `3px solid ${palette.NEGATIVE}`, paddingLeft: `${REPORT_PAD.md}px`, paddingTop: `${REPORT_PAD.xs}px`, paddingBottom: `${REPORT_PAD.xs}px` }}>
                <Text
                  size="md"
                  span
                  fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                  style={{
                    fontSize: REPORT_FONT.md,
                    fontWeight: REPORT_FONT_WEIGHT.extrabold,
                    color: palette.NEGATIVE,
                  }}
                >
                  {alert
                    ? `${fmtNum(alert.wall)} gave way · ${fmtNum(alert.spot, 1)}`
                    : `First break ${fmtNum(primaryBreak.wall)} · ${fmtNum(primaryBreak.spot, 1)}`}
                </Text>
                <Text
                  size="xs"
                  span
                  style={{
                    fontSize: REPORT_FONT.sm,
                    lineHeight: REPORT_LINE_HEIGHT.relaxed,
                    color: palette.TEXT_MUTED,
                  }}
                >
                  {primaryBreak.at.slice(11, 19)} · call wall {fmtPct(primaryBreak.erosion_30m)} · put build {fmtPct(primaryBreak.put_build_30m)} · max pain {fmtNum(primaryBreak.max_pain)}
                </Text>
                {lastBreak && lastBreak.at !== primaryBreak.at && (
                  <Text
                    size="xs"
                    span
                    style={{
                      fontSize: REPORT_FONT.xs,
                      lineHeight: REPORT_LINE_HEIGHT.relaxed,
                      color: palette.WARNING,
                    }}
                  >
                    Re-broke {lastBreak.at.slice(11, 19)} · call {fmtPct(lastBreak.erosion_30m)} · put {fmtPct(lastBreak.put_build_30m)}
                  </Text>
                )}
                <Button
                  size="xs"
                  data-testid="walls-replay-break"
                  disabled={!onReplayBreak}
                  onClick={() => onReplayBreak?.(primaryBreak.at)}
                  className="min-w-0"
                  style={{
                    marginTop: `${REPORT_PAD.sm}px`,
                    minWidth: 0,
                    paddingLeft: `${REPORT_PAD.sm}px`,
                    paddingRight: `${REPORT_PAD.sm}px`,
                    paddingTop: "4px",
                    paddingBottom: "4px",
                    fontSize: REPORT_FONT.xs,
                    fontWeight: REPORT_FONT_WEIGHT.extrabold,
                    lineHeight: 1.4,
                    color: palette.PRIMARY,
                    border: `1px solid ${palette.PRIMARY}`,
                    borderRadius: "2px",
                  }}
                >
                  REPLAY BREAK
                </Button>
              </Box>
            ) : (
              <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
                No confirmed break in the recorded window.
              </Text>
            )}
            <Text
              size="xs"
              span
              style={{
                fontSize: REPORT_FONT.xs,
                lineHeight: REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
                marginTop: `${REPORT_PAD.md}px`,
              }}
            >
              Freshness: last {walls.freshness.last_t.slice(11, 19)} · age {Math.round(walls.freshness.age_sec)}s ·
              {walls.freshness.stale ? "STALE" : "fresh"}
              {gaps.length > 0
                ? ` · last gap ${gaps[gaps.length - 1].from.slice(11, 16)}→${gaps[gaps.length - 1].to.slice(11, 16)} (${Math.round(gaps[gaps.length - 1].seconds)}s)`
                : ""}
            </Text>
          </Box>
        </Box>

        <Text
          size="xs"
          span
          style={{
            fontSize: REPORT_FONT.micro,
            color: palette.TEXT_MUTED,
          }}
        >
          Heuristic positioning read — not advice. The tape is 1-minute; chain10s is 10s. The morning is only present if the recorder ran.
        </Text>
      </Box>
    </PanelModal>
  );
}
