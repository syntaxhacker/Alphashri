import { memo, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { alpha } from "@mui/material/styles";
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
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0,1fr))",
        border: `1px solid ${palette.BORDER}`,
        bgcolor: palette.SURFACE_ALT,
      }}
    >
      {cells.map((cell, index) => (
        <Box
          key={cell.label}
          sx={{
            px: `${REPORT_PAD.sm}px`,
            py: `${REPORT_PAD.xs}px`,
            minWidth: 0,
            borderRight: index < cells.length - 1 ? `1px solid ${palette.BORDER}` : "none",
          }}
        >
          <Typography
            sx={{
              fontSize: REPORT_FONT.micro,
              lineHeight: REPORT_LINE_HEIGHT.tight,
              color: palette.TEXT_MUTED,
              letterSpacing: REPORT_LETTER_SPACING.wide,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
            }}
          >
            {cell.label}
          </Typography>
          <Typography
            sx={{
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
          </Typography>
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
      sx={{
        display: "grid",
        gridTemplateColumns: "78px minmax(0,1fr) 62px 62px",
        gap: `${REPORT_PAD.sm}px`,
        alignItems: "center",
        px: `${REPORT_PAD.sm}px`,
        py: `${REPORT_PAD.xs}px`,
        minHeight: REPORT_ROW.walls,
        borderLeft: row.tracked ? `2px solid ${color}` : "2px solid transparent",
        bgcolor: row.tracked ? palette.SURFACE_ALT : "transparent",
        transition: "background-color 180ms ease",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      }}
    >
      <Typography
        sx={{
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
      </Typography>
      <Box sx={{ height: 8, bgcolor: palette.SURFACE, position: "relative", borderRadius: "2px", overflow: "hidden" }}>
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            width: `${totalPct}%`,
            display: "flex",
            transition: "width 280ms cubic-bezier(.22,1,.36,1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        >
          <Box sx={{ width: `${oldPct}%`, bgcolor: alpha(color, 0.22) }} />
          <Box sx={{ width: `${newPct}%`, bgcolor: color }} />
        </Box>
      </Box>
      <Typography sx={{ fontSize: REPORT_FONT.sm, textAlign: "right", fontVariantNumeric: "tabular-nums", color: palette.TEXT_COLOR }}>
        {fmtOI(row.oi)}
      </Typography>
      <Typography sx={{ fontSize: REPORT_FONT.sm, textAlign: "right", fontVariantNumeric: "tabular-nums", color: erosionColor(row.new_oi) }}>
        {fmtSignedOI(row.new_oi)}
      </Typography>
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
    <Box data-testid="walls-ladder" sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ mb: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, letterSpacing: REPORT_LETTER_SPACING.wide, color: palette.TEXT_COLOR }}>
          WALL LADDER
        </Typography>
        <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>
          calls above spot · puts below · bright = new OI
        </Typography>
      </Stack>
      <Box sx={{ display: "grid", gap: `${REPORT_PAD.xs}px` }}>
        {calls.map((row) => (
          <LadderRow key={`ladder-call-${row.strike}`} row={row} side="CALL" maxOi={maxOi} breakWall={breakWall} spot={walls.spot} />
        ))}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: `${REPORT_PAD.xs}px`, minWidth: 0 }}>
          <Box sx={{ flex: 1, borderTop: `1px dashed ${palette.PRIMARY}` }} />
          <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.PRIMARY, whiteSpace: "nowrap" }}>
            SPOT {fmtNum(walls.spot, 2)}
          </Typography>
          <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}>
            MP {fmtNum(walls.max_pain)} · FLIP {fmtNum(walls.flip)}
          </Typography>
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
    <Box sx={{ width: "100%", height: 4, bgcolor: palette.SURFACE, overflow: "hidden" }}>
      <Box
        sx={{
          width: `${width}%`,
          height: "100%",
          bgcolor: erosionColor(value),
          ml: value < 0 ? "auto" : 0,
          transition: "width 280ms cubic-bezier(.22,1,.36,1)",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
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
    <Box data-testid={`walls-table-${side.toLowerCase()}`} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={0.5} sx={{ mb: `${REPORT_PAD.sm}px`, alignItems: "center" }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, color, letterSpacing: REPORT_LETTER_SPACING.wide }}>{title}</Typography>
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED }}>top {rows.length} by OI</Typography>
      </Stack>
      <Box
        component="table"
        sx={{
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
                <td align="right" title={`Old ${fmtOI(row.oi_open ?? 0)} → new ${fmtOI(row.oi)}`} style={{ padding: `${REPORT_PAD.xs}px ${REPORT_PAD.sm}px`, position: "relative" }}>
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
                    background: newOiTint(row.new_oi, rows),
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
    <Box data-testid="walls-history" sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ mb: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.TEXT_COLOR, letterSpacing: REPORT_LETTER_SPACING.wide }}>
          TRACKED WALL · {fmtNum(walls.call_wall.strike)} · LAST {walls.window_min}m
        </Typography>
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED }}>
          {first?.t?.slice(11, 16)} → {last?.t?.slice(11, 16)}
        </Typography>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>call OI · 30m Δ</Typography>
            <Typography sx={{ fontSize: REPORT_FONT.sm, fontWeight: REPORT_FONT_WEIGHT.bold, color: erosionColor(walls.tracked_call_erosion_30m) }}>
              {fmtPct(walls.tracked_call_erosion_30m)}
            </Typography>
          </Stack>
          <Box sx={{ "& svg": { width: "100%", height: 44 } }}>
            <Sparkline values={callValues} width={560} height={44} color={palette.NEGATIVE} testId="walls-call-spark" animate />
          </Box>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>put OI at the same strike · 30m Δ</Typography>
            <Typography sx={{ fontSize: REPORT_FONT.sm, fontWeight: REPORT_FONT_WEIGHT.bold, color: erosionColor(walls.tracked_put_build_30m) }}>
              {fmtPct(walls.tracked_put_build_30m)}
            </Typography>
          </Stack>
          <Box sx={{ "& svg": { width: "100%", height: 44 } }}>
            <Sparkline values={putValues} width={560} height={44} color={palette.POSITIVE} testId="walls-put-spark" animate />
          </Box>
        </Box>
      </Box>
      <Box sx={{ mt: `${REPORT_PAD.md}px` }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>max pain · drift</Typography>
          <Typography sx={{ fontSize: REPORT_FONT.sm, fontWeight: REPORT_FONT_WEIGHT.bold, color: palette.PRIMARY }}>{fmtNum(walls.max_pain_drift)}</Typography>
        </Stack>
        <Box sx={{ "& svg": { width: "100%", height: 24 } }}>
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
    <Box data-testid="walls-events" sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ mb: `${REPORT_PAD.sm}px`, alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, letterSpacing: REPORT_LETTER_SPACING.wide, color: palette.TEXT_COLOR }}>
          SEQUENCE · {events.length} events
        </Typography>
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED }}>touch → break · last 10</Typography>
      </Stack>
      <Box
        component="table"
        sx={{
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
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED, mt: `${REPORT_PAD.sm}px` }}>
          +{hidden} earlier events in the recorded window
        </Typography>
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
      maxWidth={1240}
      autoHeight
      maxHeight="92vh"
      title={
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.25, alignItems: "center" }}>
          <Typography sx={{ fontSize: REPORT_FONT.lg, fontWeight: REPORT_FONT_WEIGHT.extrabold, letterSpacing: REPORT_LETTER_SPACING.wider }}>WALLS · {walls.symbol}</Typography>
          <Chip
            size="small"
            label={walls.state.replace("_", " ")}
            sx={{
              height: 20,
              fontSize: REPORT_FONT.xs,
              fontWeight: REPORT_FONT_WEIGHT.extrabold,
              color: stateColor,
              bgcolor: "transparent",
              border: `1px solid ${stateColor}`,
              "& .MuiChip-label": { px: `${REPORT_PAD.sm}px` },
            }}
          />
          <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>
            {dteLabel} · {walls.expiry ?? "—"} · {walls.freshness.rows} rows
          </Typography>
        </Stack>
      }
    >
      <Box sx={{ p: `${REPORT_PAD.sm}px`, display: "flex", flexDirection: "column", gap: `${REPORT_PAD.sm}px` }}>
        <StatBar walls={walls} />

        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: `${REPORT_PAD.sm}px` }}>
          <Typography sx={{ fontSize: REPORT_FONT.micro, fontWeight: REPORT_FONT_WEIGHT.bold, letterSpacing: REPORT_LETTER_SPACING.wide, color: palette.TEXT_MUTED }}>
            VIEW
          </Typography>
          <Stack direction="row" spacing={0.4}>
            {(["MAP", "DATA"] as const).map((mode) => (
              <Button
                key={mode}
                size="small"
                aria-pressed={activeView === mode}
                disabled={mode === "MAP" && !walls.wall_map}
                onClick={() => chooseView(mode)}
                sx={{
                  minWidth: 0,
                  px: `${REPORT_PAD.sm}px`,
                  py: "1px",
                  fontSize: REPORT_FONT.xs,
                  fontWeight: REPORT_FONT_WEIGHT.extrabold,
                  lineHeight: 1.4,
                  color: activeView === mode ? palette.TEXT_COLOR : palette.TEXT_MUTED,
                  bgcolor: activeView === mode ? palette.SURFACE_ALT : "transparent",
                  border: `1px solid ${activeView === mode ? palette.BORDER : "transparent"}`,
                  borderRadius: "2px",
                  "&:hover": { bgcolor: palette.SURFACE_ALT },
                  "&.Mui-disabled": { color: palette.TEXT_MUTED, opacity: 0.4 },
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

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
              <WallsTable title="CALL WALLS" side="CALL" rows={walls.calls} spot={walls.spot} />
              <WallsTable title="PUT WALLS" side="PUT" rows={walls.puts} spot={walls.spot} />
            </Box>

            <HistoryChart walls={walls} />
          </>
        )}

        <Divider sx={{ borderColor: palette.BORDER }} />

        <SequenceTable events={events} />

        <Divider sx={{ borderColor: palette.BORDER }} />

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" }, gap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, letterSpacing: REPORT_LETTER_SPACING.wide, color: palette.TEXT_COLOR, mb: `${REPORT_PAD.sm}px` }}>
              READ
            </Typography>
            <Typography data-testid="walls-read" sx={{ fontSize: REPORT_FONT.sm, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_COLOR }}>
              {walls.read ||
                (walls.expiry_day
                  ? "0-DTE: the walls sit at the spot. A break needs the call wall to erode, the put floor to build, and max pain to drift — the 14:25 gamma leg, not the 14:04 touch."
                  : "Non-expiry: wall erosion is positioning. The violent 0-DTE gamma/pin does not apply; watch the wall as a level, not a pin.")}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.4, mt: `${REPORT_PAD.md}px` }}>
              {walls.reasons.map((reason) => (
                <Chip
                  key={reason}
                  size="small"
                  label={reason}
                  sx={{
                    height: 19,
                    fontSize: REPORT_FONT.xs,
                    color: palette.TEXT_MUTED,
                    bgcolor: palette.SURFACE_ALT,
                    "& .MuiChip-label": { px: `${REPORT_PAD.sm}px` },
                  }}
                />
              ))}
            </Stack>
          </Box>
          <Box>
            <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, letterSpacing: REPORT_LETTER_SPACING.wide, color: palette.TEXT_COLOR, mb: `${REPORT_PAD.sm}px` }}>
              BREAK
            </Typography>
            {primaryBreak ? (
              <Box data-testid="walls-break" sx={{ borderLeft: `3px solid ${palette.NEGATIVE}`, pl: `${REPORT_PAD.md}px`, py: `${REPORT_PAD.xs}px` }}>
                <Typography sx={{ fontSize: REPORT_FONT.md, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.NEGATIVE }}>
                  {alert
                    ? `${fmtNum(alert.wall)} gave way · ${fmtNum(alert.spot, 1)}`
                    : `First break ${fmtNum(primaryBreak.wall)} · ${fmtNum(primaryBreak.spot, 1)}`}
                </Typography>
                <Typography sx={{ fontSize: REPORT_FONT.sm, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED }}>
                  {primaryBreak.at.slice(11, 19)} · call wall {fmtPct(primaryBreak.erosion_30m)} · put build {fmtPct(primaryBreak.put_build_30m)} · max pain {fmtNum(primaryBreak.max_pain)}
                </Typography>
                {lastBreak && lastBreak.at !== primaryBreak.at && (
                  <Typography sx={{ fontSize: REPORT_FONT.xs, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.WARNING }}>
                    Re-broke {lastBreak.at.slice(11, 19)} · call {fmtPct(lastBreak.erosion_30m)} · put {fmtPct(lastBreak.put_build_30m)}
                  </Typography>
                )}
                <Button
                  size="small"
                  data-testid="walls-replay-break"
                  disabled={!onReplayBreak}
                  onClick={() => onReplayBreak?.(primaryBreak.at)}
                  sx={{
                    mt: `${REPORT_PAD.sm}px`,
                    minWidth: 0,
                    px: `${REPORT_PAD.sm}px`,
                    py: "1px",
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
              <Typography sx={{ fontSize: REPORT_FONT.sm, color: palette.TEXT_MUTED }}>
                No confirmed break in the recorded window.
              </Typography>
            )}
            <Typography sx={{ fontSize: REPORT_FONT.xs, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED, mt: `${REPORT_PAD.md}px` }}>
              Freshness: last {walls.freshness.last_t.slice(11, 19)} · age {Math.round(walls.freshness.age_sec)}s ·{" "}
              {walls.freshness.stale ? "STALE" : "fresh"}
              {gaps.length > 0
                ? ` · last gap ${gaps[gaps.length - 1].from.slice(11, 16)}→${gaps[gaps.length - 1].to.slice(11, 16)} (${Math.round(gaps[gaps.length - 1].seconds)}s)`
                : ""}
            </Typography>
          </Box>
        </Box>

        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED }}>
          Heuristic positioning read — not advice. The tape is 1-minute; chain10s is 10s. The morning is only present if the recorder ran.
        </Typography>
      </Box>
    </PanelModal>
  );
}
