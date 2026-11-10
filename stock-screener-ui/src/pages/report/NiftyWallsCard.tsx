import { memo, useEffect, useState, ReactNode } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import { CompactPanel } from "@/components/common/compact";
import { Sparkline } from "@/components/common/Sparkline";
import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload, WallsRow } from "@/api/reportNifty";
import {
  STATE_COLOR,
  dist,
  erosionColor,
  firstBreakEvent,
  erosionArrow,
  flowLabel,
  flowTone,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtPremChange,
  fmtRate,
  fmtSignedOI,
  fmtVolMult,
  formatDte,
  lastBreakEvent,
  newOiTint,
  statusTone,
  wallsMaxOi,
} from "./niftyWallsFormat";
import { wallCode, wallSide } from "./niftyChartMath";
import { wallErosionView } from "./wallErosion";
import {
  REPORT_FONT,
  REPORT_ROW,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

/** The walls band always reserves three rows per side: the Index Report is a
 *  one-page layout, so a thin payload (or a null payload) must never shrink
 *  the card. */
const WALLS_ROWS = 3;

/** Capped columns: strike minmax(0,210px) so strike and numbers stay one unit;
 *  OI 48px, NEW 48px, 5m 40px, 30m 40px, DIST 44px stay fixed and readable. */
const WALLS_COLS = "minmax(0, 210px) 48px 48px 40px 40px 44px";

const WALLS_HEADINGS = ["OI", "NEW", "5m", "30m", "DIST"] as const;

/** Fixed reservation for the READ/SEQ and tracked-history columns so the null
 *  skeleton keeps the same band height as the populated card. */
const WALLS_RESERVED_H = 96;

/** The walls band grid: state/stats | CALL | PUT | READ+SEQ | tracked history. */
const WALLS_GRID_COLS = {
  xs: "minmax(0,1fr)",
  md: "250px 1fr 1fr minmax(280px,1fr) minmax(120px,1fr)",
} as const;

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 0, py: "1px" }}>
      <Typography
        sx={{
          fontSize: REPORT_FONT.micro,
          lineHeight: REPORT_LINE_HEIGHT.tight,
          color: palette.TEXT_MUTED,
          letterSpacing: REPORT_LETTER_SPACING.wide,
          fontWeight: REPORT_FONT_WEIGHT.extrabold,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: REPORT_FONT.md,
          lineHeight: REPORT_LINE_HEIGHT.snug,
          fontWeight: REPORT_FONT_WEIGHT.bold,
          color: color ?? palette.TEXT_COLOR,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function toneColor(tone: "positive" | "warning" | "negative" | "muted"): string {
  switch (tone) {
    case "positive":
      return palette.POSITIVE;
    case "negative":
      return palette.NEGATIVE;
    case "warning":
      return palette.WARNING;
    default:
      return palette.TEXT_MUTED;
  }
}

function flowToneColor(tone: "bull" | "bear" | "muted"): string {
  return tone === "bull" ? palette.POSITIVE : tone === "bear" ? palette.NEGATIVE : palette.TEXT_MUTED;
}

// Call-wall erosion is upside fuel for the desk and put-wall erosion is
// downside fuel, so colour the erosion cells by that fuel direction (side +
// status) — never by the erosion sign alone.
function wallFuelColor(side: "CALL" | "PUT", row: WallsRow): string {
  const arrow = erosionArrow(side, row.status ?? "");
  if (arrow === "▲") return palette.POSITIVE;
  if (arrow === "▼") return palette.NEGATIVE;
  return toneColor(statusTone(row.status));
}

/** A reserved row slot: same grid, same two-line strike cell and the same
 *  row height as a live row, so the table never shrinks. */
function WallPlaceholderRow({ side }: { side: "CALL" | "PUT" }) {
  return (
    <Box
      data-testid={`nifty-walls-${side.toLowerCase()}-placeholder`}
      data-placeholder="true"
      data-wall-row="true"
      sx={{
        display: "grid",
        gridTemplateColumns: WALLS_COLS,
        columnGap: `${REPORT_PAD.xs}px`,
        alignItems: "center",
        py: `${REPORT_PAD.xs}px`,
        pl: `${REPORT_PAD.sm}px`,
        minHeight: REPORT_ROW.walls,
        borderLeft: "2px solid transparent",
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: `${REPORT_PAD.xs}px`, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: REPORT_FONT.sm,
            lineHeight: REPORT_LINE_HEIGHT.snug,
            color: palette.TEXT_MUTED,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          —
        </Typography>
        <Typography
          sx={{
            fontSize: REPORT_FONT.micro,
            lineHeight: REPORT_LINE_HEIGHT.tight,
            color: palette.TEXT_MUTED,
          }}
        >
          —
        </Typography>
      </Box>
      {WALLS_HEADINGS.map((heading) => (
        <Typography
          key={heading}
          sx={{
            fontSize: REPORT_FONT.sm,
            lineHeight: REPORT_LINE_HEIGHT.snug,
            textAlign: "right",
            color: palette.TEXT_MUTED,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          —
        </Typography>
      ))}
    </Box>
  );
}

function WallTable({ side, rows, spot }: { side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const maxOi = wallsMaxOi(rows);
  const sideKey = side.toLowerCase();
  // Three rows always: the missing ones are reserved slots, so a one-wall
  // payload leaves the table exactly as tall as a three-wall payload.
  const placeholders = Math.max(0, WALLS_ROWS - Math.min(rows.length, WALLS_ROWS));
  const display: (WallsRow | null)[] = [
    ...rows.slice(0, WALLS_ROWS),
    ...Array.from({ length: placeholders }, () => null),
  ];
  return (
    <Box data-testid={`nifty-walls-${sideKey}`} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: WALLS_COLS,
          columnGap: `${REPORT_PAD.xs}px`,
          borderBottom: `1px solid ${palette.BORDER}`,
          pb: `${REPORT_PAD.xs}px`,
          mb: `${REPORT_PAD.xs}px`,
        }}
      >
        <Typography
          sx={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color,
            letterSpacing: REPORT_LETTER_SPACING.wider,
          }}
        >
          {side}
        </Typography>
        {WALLS_HEADINGS.map((heading) => (
          <Typography
            key={heading}
            title={heading === "NEW" ? "New OI since session open (old book → new book)" : undefined}
            sx={{
              fontSize: REPORT_FONT.xs,
              color: palette.TEXT_MUTED,
              textAlign: "right",
              letterSpacing: REPORT_LETTER_SPACING.normal,
            }}
          >
            {heading}
          </Typography>
        ))}
      </Box>
      {display.map((row, index) => {
        if (!row) {
          return <WallPlaceholderRow key={`${side}-placeholder-${index}`} side={side} />;
        }
        const view = wallErosionView(row, side);
        const nearest = Boolean(row.nearest);
        const tracked = Boolean(row.tracked);
        const flowLabelText = flowLabel(row.flow);
        const volText = fmtVolMult(row.vol_mult);
        const flowSuffix =
          flowLabelText !== "—" || volText !== "—" ? `${flowLabelText} · vol ${volText}` : "—";
        const parts = row.fuel_parts;
        const partsTitle = parts
          ? ` · parts: erosion ${parts.erosion}, volume ${parts.volume}, proximity ${parts.proximity}, gamma ${parts.gamma}, flow ${parts.flow}`
          : "";
        const cellColor = wallFuelColor(side, row);
        const border = nearest
          ? `2px solid ${cellColor}`
          : tracked
            ? `2px solid ${color}`
            : "2px solid transparent";
        return (
          <Box
            key={`${side}-${row.strike}`}
            data-wall-row="true"
            sx={{
              display: "grid",
              gridTemplateColumns: WALLS_COLS,
              columnGap: `${REPORT_PAD.xs}px`,
              alignItems: "center",
              py: `${REPORT_PAD.xs}px`,
              pl: `${REPORT_PAD.sm}px`,
              minHeight: REPORT_ROW.walls,
              borderLeft: border,
              bgcolor: (nearest || tracked) ? palette.SURFACE_ALT : "transparent",
              transition: "background-color 180ms ease",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: `${REPORT_PAD.xs}px`, minWidth: 0 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: `${REPORT_PAD.xs}px`,
                  minWidth: 0,
                }}
              >
                <Typography
                  sx={{
                    fontSize: REPORT_FONT.sm,
                    lineHeight: REPORT_LINE_HEIGHT.snug,
                    fontWeight: tracked ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium,
                    color: tracked ? color : palette.TEXT_COLOR,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fmtNum(row.strike)}
                </Typography>
                {nearest && (
                  <Box
                    sx={{
                      width: 3,
                      height: 3,
                      borderRadius: "50%",
                      bgcolor: cellColor,
                      flexShrink: 0,
                    }}
                  />
                )}
                {view.arrow !== "—" && (
                  <Typography
                    sx={{
                      fontSize: REPORT_FONT.micro,
                      fontWeight: REPORT_FONT_WEIGHT.extrabold,
                      color: cellColor,
                      marginLeft: `${REPORT_PAD.xs}px`,
                      flexShrink: 0,
                    }}
                  >
                    {view.arrow}
                  </Typography>
                )}
                <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 3, color: palette.TEXT_MUTED }}>
                  {wallCode(side === "CALL", wallSide(row.strike, spot), false)}
                </span>
              </Box>
              <Typography
                sx={{
                  fontSize: REPORT_FONT.micro,
                  lineHeight: REPORT_LINE_HEIGHT.tight,
                  color: flowToneColor(flowTone(row.flow)),
                  fontWeight: REPORT_FONT_WEIGHT.bold,
                  minWidth: 0,
                }}
                title={
                  flowSuffix !== "—"
                    ? `${flowLabelText} · vol ${volText} · prem ${fmtPremChange(row.prem_chg_5m)} · fuel ${view.fuelScore}${partsTitle}`
                    : undefined
                }
                data-testid={`nifty-walls-${side.toLowerCase()}-${row.strike}-flow`}
              >
                {flowSuffix}
              </Typography>
            </Box>
            <Box
              title={`Old ${fmtOI(row.oi_open)} → new ${fmtOI(row.oi)}`}
              sx={{ position: "relative", minWidth: 0, alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "flex-end" }}
            >
              <Box
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 2,
                  bgcolor: palette.SURFACE,
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    width: `${Math.min(100, (row.oi / maxOi) * 100)}%`,
                    height: "100%",
                    bgcolor: color,
                    opacity: 0.55,
                    transition: "width 280ms cubic-bezier(.22,1,.36,1)",
                    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                  }}
                />
              </Box>
              <Typography
                sx={{
                  fontSize: REPORT_FONT.sm,
                  lineHeight: REPORT_LINE_HEIGHT.snug,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: palette.TEXT_COLOR,
                }}
              >
                {fmtOI(row.oi)}
              </Typography>
            </Box>
            <Typography
              title={`Old ${fmtOI(row.oi_open)} → new ${fmtOI(row.oi)} · ${fmtPct(row.new_oi_pct)} of old book`}
              sx={{
                fontSize: REPORT_FONT.sm,
                lineHeight: REPORT_LINE_HEIGHT.snug,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                color: erosionColor(row.new_oi),
                bgcolor: newOiTint(row.new_oi, rows),
                borderRadius: `${REPORT_RADIUS.sm}px`,
                px: `${REPORT_PAD.xs}px`,
                transition: "background-color 220ms ease",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
              }}
            >
              {fmtSignedOI(row.new_oi)}
            </Typography>
            <Typography
              title={row.erosion_5m != null ? `5m erosion ${fmtPct(row.erosion_5m)} · 30m rate ${fmtRate(row.erosion_rate_30m)}` : undefined}
              sx={{
                fontSize: REPORT_FONT.sm,
                lineHeight: REPORT_LINE_HEIGHT.snug,
                textAlign: "right",
                color: cellColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtPct(row.erosion_5m)}
            </Typography>
            <Typography
              title={`30m erosion ${fmtPct(row.erosion_30m)} · rate ${fmtRate(row.erosion_rate_30m)} · prem ${fmtPremChange(row.prem_chg_5m)}`}
              sx={{
                fontSize: REPORT_FONT.sm,
                lineHeight: REPORT_LINE_HEIGHT.snug,
                textAlign: "right",
                color: cellColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtPct(row.erosion_30m)}
            </Typography>
            <Typography
              sx={{
                fontSize: REPORT_FONT.sm,
                lineHeight: REPORT_LINE_HEIGHT.snug,
                textAlign: "right",
                color: palette.TEXT_MUTED,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {dist(row.distance_pct)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function SequenceLine({ events }: { events: WallsEvent[] }) {
  const recent = events.slice(-3);
  const hidden = events.length - recent.length;
  const firstBreakAt = firstBreakEvent(events)?.at;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: `${REPORT_PAD.sm}px`, minWidth: 0, overflow: "hidden" }}>
      <Typography
        sx={{
          fontSize: REPORT_FONT.micro,
          fontWeight: REPORT_FONT_WEIGHT.extrabold,
          color: palette.TEXT_MUTED,
          letterSpacing: REPORT_LETTER_SPACING.wider,
          flexShrink: 0,
        }}
      >
        SEQ
      </Typography>
      {hidden > 0 && (
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED, flexShrink: 0 }}>+{hidden}</Typography>
      )}
      {recent.map((event, index) => {
        const isBreak = event.kind === "BREAK";
        const isFirst = isBreak && event.at === firstBreakAt;
        return (
          <Box
            key={`${event.at}-${index}`}
            data-wall-anim=""
            sx={{
              display: "flex",
              alignItems: "center",
              gap: `${REPORT_PAD.xs}px`,
              flexShrink: 0,
              animation: "wall-event-in 160ms cubic-bezier(.22,1,.36,1)",
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          >
            <Box
              sx={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                bgcolor: isBreak ? palette.NEGATIVE : palette.WARNING,
              }}
            />
            <Typography
              sx={{
                fontSize: REPORT_FONT.micro,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {event.at.slice(11, 16)}
            </Typography>
            <Typography
              sx={{
                fontSize: REPORT_FONT.xsPlus,
                fontWeight: isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
              }}
            >
              {isBreak ? (isFirst ? "BREAK" : "RE-BRK") : "TOUCH"}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function MiniHistory({ walls }: { walls: WallsPayload }) {
  const callValues = walls.history.map((point) => point.call_oi ?? null);
  const putValues = walls.history.map((point) => point.put_oi ?? null);
  const first = walls.history[0];
  const last = walls.history[walls.history.length - 1];
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography
          sx={{
            fontSize: REPORT_FONT.micro,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            letterSpacing: REPORT_LETTER_SPACING.wide,
          }}
        >
          TRACKED WALL {fmtNum(walls.call_wall.strike)} · LAST {walls.window_min}m
        </Typography>
        <Typography sx={{ fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED }}>
          {first?.t?.slice(11, 16)} → {last?.t?.slice(11, 16)}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mt: `${REPORT_PAD.xs}px` }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>call OI · 30m Δ</Typography>
        <Typography
          sx={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.bold,
            color: erosionColor(walls.tracked_call_erosion_30m),
          }}
        >
          {fmtPct(walls.tracked_call_erosion_30m)}
        </Typography>
      </Stack>
      <Box sx={{ "& svg": { width: "100%", height: 18, maxWidth: 420 } }}>
        <Sparkline values={callValues} width={420} height={18} color={palette.NEGATIVE} testId="walls-card-call-spark" animate responsive />
      </Box>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>put OI · 30m Δ</Typography>
        <Typography
          sx={{
            fontSize: REPORT_FONT.xs,
            fontWeight: REPORT_FONT_WEIGHT.bold,
            color: erosionColor(walls.tracked_put_build_30m),
          }}
        >
          {fmtPct(walls.tracked_put_build_30m)}
        </Typography>
      </Stack>
      <Box sx={{ "& svg": { width: "100%", height: 18, maxWidth: 420 } }}>
        <Sparkline values={putValues} width={420} height={18} color={palette.POSITIVE} testId="walls-card-put-spark" animate responsive />
      </Box>
    </Box>
  );
}

/** Muted placeholder block used by the null-payload skeleton. */
function SkeletonBar({ height, width = "100%" }: { height: number; width?: number | string }) {
  return (
    <Box
      sx={{
        height: `${height}px`,
        width: typeof width === "number" ? `${width}px` : width,
        borderRadius: `${REPORT_RADIUS.sm}px`,
        bgcolor: palette.SURFACE_ALT,
      }}
    />
  );
}

/** Mirrors the `Stat` block (label over value) so the reserved stats column
 *  keeps the height of the live one. */
function SkeletonStat() {
  return (
    <Box sx={{ minWidth: 0, py: "1px" }}>
      <SkeletonBar height={11} width="42%" />
      <SkeletonBar height={15} width="68%" />
    </Box>
  );
}

/** The levels rows live inside this card in both states — dropping them on a
 *  null payload would change the card height by the levels band. */
function WallsLevelsBlock({ levels }: { levels?: ReactNode }) {
  if (!levels) return null;
  return (
    <Box
      sx={{
        borderTop: `1px solid ${palette.BORDER}`,
        pt: `${REPORT_PAD.sm}px`,
        minWidth: 0,
      }}
    >
      {levels}
    </Box>
  );
}

/** Null-payload skeleton: same bands, same row counts and the same reserved
 *  heights as the populated card, so the one-page Index Report never reflows
 *  when the walls payload arrives.
 *
 *  Height budget: the CALL/PUT tables are the tallest band (~21px header +
 *  3 rows of ~31px ≈ 114px) and both states render exactly three rows per
 *  side, so the skeleton body lands on the same height as the populated one.
 *  The READ/SEQ and tracked-history bands are reserved at 96px so they can
 *  never collapse below the live bands. */
function WallsSkeleton({ emptyText }: { emptyText: string }) {
  return (
    <Box
      data-testid="nifty-walls-skeleton"
      sx={{
        display: "grid",
        gridTemplateColumns: WALLS_GRID_COLS,
        gap: `${REPORT_PAD.sm}px`,
        p: `${REPORT_PAD.sm}px`,
        alignItems: "start",
      }}
    >
      <Box data-testid="nifty-walls-skeleton-strip" sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: `${REPORT_PAD.xs}px` }}
        >
          <SkeletonBar height={18} width={64} />
          <SkeletonBar height={12} width={46} />
          <SkeletonBar height={12} width={108} />
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: `${REPORT_PAD.md}px`,
            rowGap: `${REPORT_PAD.xs}px`,
            mt: `${REPORT_PAD.sm}px`,
          }}
        >
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </Box>
        <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED, mt: `${REPORT_PAD.xs}px` }}>
          {emptyText}
        </Typography>
      </Box>

      <WallTable side="CALL" rows={[]} spot={0} />
      <WallTable side="PUT" rows={[]} spot={0} />

      <Box
        data-testid="nifty-walls-skeleton-read"
        sx={{
          minHeight: WALLS_RESERVED_H,
          minWidth: 0,
          borderLeft: `1px solid ${palette.BORDER}`,
          pl: `${REPORT_PAD.sm}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <Typography
          sx={{
            fontSize: REPORT_FONT.micro,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            letterSpacing: REPORT_LETTER_SPACING.wider,
          }}
        >
          READ
        </Typography>
        <SkeletonBar height={10} width="92%" />
        <SkeletonBar height={10} width="76%" />
        <SkeletonBar height={10} width="84%" />
        <Typography
          sx={{
            fontSize: REPORT_FONT.micro,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            letterSpacing: REPORT_LETTER_SPACING.wider,
            mt: `${REPORT_PAD.sm}px`,
          }}
        >
          SEQ
        </Typography>
        <SkeletonBar height={10} width="60%" />
      </Box>

      <Box
        data-testid="nifty-walls-skeleton-history"
        sx={{
          minHeight: WALLS_RESERVED_H,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <SkeletonBar height={11} width="58%" />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
      </Box>
    </Box>
  );
}

export function NiftyWallsCardInner({
  walls,
  onExpand,
  onOpenDesk,
  emptyText = "No walls data.",
  levels,
}: {
  walls: WallsPayload | null;
  onExpand: () => void;
  /** Opens the deeper pressure desk (phase plane + selected-wall path). */
  onOpenDesk?: () => void;
  emptyText?: string;
  /** Optional dense levels rows (e.g. LevelsInPlayContent) rendered inside
   *  this same card, after the walls grid. */
  levels?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  // One alert per wall per cooldown: the backend latches `alert.at` to the
  // first break of the run; localStorage makes the dismiss survive reloads
  // and suppresses a re-break inside the same 15-minute window.
  useEffect(() => {
    if (!walls?.alert) return;
    const alert = walls.alert;
    const key = `walls.alert.v1.${walls.symbol}.${walls.date}.${alert.wall}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return;
      const storedAt = Date.parse(stored);
      const at = Date.parse(alert.at);
      if (
        storedAt === at ||
        (Number.isFinite(at) &&
          Number.isFinite(storedAt) &&
          at - storedAt < alert.cooldown_min * 60_000)
      ) {
        setDismissed(alert.at);
      }
    } catch {
      /* localStorage can be blocked; the in-memory dismiss still works */
    }
  }, [walls?.alert?.at, walls?.alert?.wall, walls?.symbol, walls?.date]);

  if (!walls) {
    return (
      <CompactPanel title="WALLS" testId="nifty-walls-card" padded={false}>
        <WallsSkeleton emptyText={emptyText} />
        <WallsLevelsBlock levels={levels} />
      </CompactPanel>
    );
  }
  const stateColor = STATE_COLOR[walls.state] ?? palette.TEXT_MUTED;
  const alert = walls.alert;
  const showAlert = Boolean(alert && walls.alert_eligible && dismissed !== alert.at);
  const events = walls.events ?? [];
  const firstBreak = firstBreakEvent(events) ?? null;
  const lastBreak = lastBreakEvent(events) ?? null;
  const breakEvent = firstBreak ?? lastBreak;
  const dteLabel = formatDte(walls.dte);
  const pinColor =
    Math.abs(walls.pin_distance_pct) <= 0.15 ? palette.PRIMARY : palette.TEXT_MUTED;
  const dismiss = (at: string, wall: number) => {
    setDismissed(at);
    try {
      window.localStorage.setItem(
        `walls.alert.v1.${walls.symbol}.${walls.date}.${wall}`,
        at,
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <CompactPanel
      title="WALLS"
      testId="nifty-walls-card"
      padded={false}
      action={
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {onOpenDesk ? (
            <Button
              size="small"
              variant="outlined"
              data-testid="nifty-walls-desk"
              onClick={onOpenDesk}
              sx={{ py: 0, px: `${REPORT_PAD.sm}px`, minWidth: 0, fontSize: REPORT_FONT.micro }}
            >
              DESK
            </Button>
          ) : null}
          <Button
            size="small"
            variant="outlined"
            onClick={onExpand}
            sx={{ py: 0, px: `${REPORT_PAD.sm}px`, minWidth: 0, fontSize: REPORT_FONT.micro }}
          >
            EXPAND
          </Button>
        </Stack>
      }
      sx={{ borderTop: "none" }}
    >
      <Box
        sx={{
          display: "grid",
          // Widened wall tables: 250px | flex | flex | minmax(280px,1fr) | flex
          gridTemplateColumns: WALLS_GRID_COLS,
          gap: `${REPORT_PAD.sm}px`,
          p: `${REPORT_PAD.sm}px`,
          alignItems: "start",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: `${REPORT_PAD.xs}px` }}>
            <Chip
                size="small"
                label={walls.state.replace("_", " ")}
                sx={{
                  height: 18,
                  fontSize: REPORT_FONT.xs,
                  fontWeight: REPORT_FONT_WEIGHT.extrabold,
                  letterSpacing: REPORT_LETTER_SPACING.wide,
                  color: stateColor,
                  bgcolor: "transparent",
                  border: `1px solid ${stateColor}`,
                  "& .MuiChip-label": { px: `${REPORT_PAD.xs}px` },
                }}
              />
              {dteLabel && (
                <Typography
                  sx={{
                    fontSize: REPORT_FONT.xs,
                    fontWeight: REPORT_FONT_WEIGHT.bold,
                    color: walls.expiry_day ? palette.WARNING : palette.TEXT_MUTED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {dteLabel}
                </Typography>
              )}
              <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}>
                {walls.expiry ?? "—"} · tape {walls.freshness.last_t.slice(11, 16)}
              </Typography>
              {walls.freshness.stale && (
                <Chip
                  size="small"
                  label="STALE"
                  sx={{
                    height: 17,
                    fontSize: REPORT_FONT.xs,
                    color: palette.WARNING,
                    bgcolor: "transparent",
                    border: `1px solid ${palette.WARNING}`,
                    "& .MuiChip-label": { px: `${REPORT_PAD.xs}px` },
                  }}
                />
              )}
            </Stack>

            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: `${REPORT_PAD.md}px`, rowGap: `${REPORT_PAD.xs}px`, mt: `${REPORT_PAD.sm}px` }}>
              <Stat label="SPOT" value={fmtNum(walls.spot, 2)} />
              <Stat label="MAX PAIN" value={fmtNum(walls.max_pain)} />
              <Stat
                label="PIN"
                value={`${walls.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls.pin_distance_pts, 0)} (${walls.pin_distance_pct.toFixed(2)}%)`}
                color={pinColor}
              />
              <Stat
                label="GEX"
                value={walls.gex_degraded ? "n/a" : fmtNum(walls.net_gex, 1)}
                color={walls.gex_degraded ? palette.TEXT_MUTED : palette.TEXT_COLOR}
              />
            </Box>

        </Box>

        <WallTable side="CALL" rows={walls.calls} spot={walls.spot} />
        <WallTable side="PUT" rows={walls.puts} spot={walls.spot} />

        <Box sx={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: `${REPORT_PAD.md}px` }}>
          <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: `${REPORT_PAD.sm}px` }}>
            {showAlert && alert ? (
              <Box
                data-testid="nifty-walls-alert"
                data-wall-anim=""
                sx={{
                  borderLeft: `3px solid ${palette.NEGATIVE}`,
                  bgcolor: palette.SURFACE_ALT,
                  px: `${REPORT_PAD.sm}px`,
                  py: `${REPORT_PAD.xs}px`,
                  animation: "wall-alert-in 180ms cubic-bezier(.22,1,.36,1)",
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: `${REPORT_PAD.sm}px` }}>
                  <Typography
                    sx={{
                      fontSize: REPORT_FONT.xs,
                      fontWeight: REPORT_FONT_WEIGHT.extrabold,
                      color: palette.NEGATIVE,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    WALL BREAK · {fmtNum(alert.wall)} · {fmtNum(alert.spot, 1)}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => dismiss(alert.at, alert.wall)}
                    sx={{ minWidth: 0, py: 0, px: `${REPORT_PAD.xs}px`, fontSize: REPORT_FONT.micro, color: palette.TEXT_MUTED, flexShrink: 0 }}
                  >
                    dismiss
                  </Button>
                </Stack>
                <Typography sx={{ fontSize: REPORT_FONT.xsPlus, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED }}>
                  call {fmtPct(alert.erosion_30m)} · put {fmtPct(alert.put_build_30m)} · {alert.at.slice(11, 19)}
                </Typography>
              </Box>
            ) : breakEvent ? (
              <Box sx={{ pl: `${REPORT_PAD.sm}px`, borderLeft: `2px solid ${palette.NEGATIVE}`, display: "flex", flexDirection: "column", gap: `${REPORT_PAD.xs}px` }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: `${REPORT_PAD.xs}px` }}>
                  <Typography sx={{ fontSize: REPORT_FONT.micro, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.TEXT_MUTED, letterSpacing: REPORT_LETTER_SPACING.wide }}>
                    FIRST BREAK
                  </Typography>
                  <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.NEGATIVE, fontVariantNumeric: "tabular-nums" }}>
                    {breakEvent.at.slice(11, 19)} · {fmtNum(breakEvent.wall)}
                  </Typography>
                  <Typography sx={{ fontSize: REPORT_FONT.xsPlus, color: palette.TEXT_MUTED }}>
                    call {fmtPct(breakEvent.erosion_30m)} · put {fmtPct(breakEvent.put_build_30m)}
                  </Typography>
                </Stack>
                {lastBreak && lastBreak.at !== breakEvent.at && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: `${REPORT_PAD.xs}px` }}>
                    <Typography sx={{ fontSize: REPORT_FONT.micro, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.WARNING, letterSpacing: REPORT_LETTER_SPACING.wide }}>
                      RE-BROKE
                    </Typography>
                    <Typography sx={{ fontSize: REPORT_FONT.xs, fontWeight: REPORT_FONT_WEIGHT.bold, color: palette.WARNING, fontVariantNumeric: "tabular-nums" }}>
                      {lastBreak.at.slice(11, 19)} · {fmtNum(lastBreak.wall)}
                    </Typography>
                    <Typography sx={{ fontSize: REPORT_FONT.xsPlus, color: palette.TEXT_MUTED }}>
                      call {fmtPct(lastBreak.erosion_30m)} · put {fmtPct(lastBreak.put_build_30m)}
                    </Typography>
                  </Stack>
                )}
              </Box>
            ) : walls.expiry_day ? (
              <Typography sx={{ fontSize: REPORT_FONT.xs, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED }}>
                No confirmed break in the window.
              </Typography>
            ) : null}
            <SequenceLine events={events} />
          </Box>

          <Box sx={{ minWidth: 0, borderLeft: `1px solid ${palette.BORDER}`, pl: `${REPORT_PAD.sm}px` }}>
            <Typography sx={{ fontSize: REPORT_FONT.micro, fontWeight: REPORT_FONT_WEIGHT.extrabold, color: palette.TEXT_MUTED, letterSpacing: REPORT_LETTER_SPACING.wider }}>
              READ
            </Typography>
            <Typography sx={{ fontSize: REPORT_FONT.xsPlus, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED, mt: `${REPORT_PAD.xs}px` }}>
              {walls.reasons.slice(0, 4).join(" · ")}
            </Typography>
            <Typography sx={{ fontSize: REPORT_FONT.xsPlus, lineHeight: REPORT_LINE_HEIGHT.relaxed, color: palette.TEXT_MUTED, mt: `${REPORT_PAD.sm}px` }}>
              {walls.expiry_day ? "break = erosion + put floor" : "Non-expiry: positioning, not gamma"}
            </Typography>
          </Box>
        </Box>

        <MiniHistory walls={walls} />
      </Box>
      <WallsLevelsBlock levels={levels} />
    </CompactPanel>
  );
}

/** Memoised: the report panel re-renders on every ~1 s spot tick, and this
 *  card's inputs (`walls` object, stable callbacks) only change per poll. */
export const NiftyWallsCard = memo(NiftyWallsCardInner);
NiftyWallsCard.displayName = "NiftyWallsCard";
