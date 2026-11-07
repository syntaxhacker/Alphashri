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
  REPORT_RADIUS,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

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

function WallTable({ side, rows, spot }: { side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const maxOi = wallsMaxOi(rows);
  // Capped columns: strike minmax(0,210px) so strike and numbers stay one unit;
  // OI 48px, NEW 48px, 5m 40px, 30m 40px, DIST 44px stay fixed and readable.
  const cols = "minmax(0, 210px) 48px 48px 40px 40px 44px";
  return (
    <Box data-testid={`nifty-walls-${side.toLowerCase()}`} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: cols,
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
        {["OI", "NEW", "5m", "30m", "DIST"].map((heading) => (
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
      {rows.slice(0, 3).map((row) => (
        <Box
          key={`${side}-${row.strike}`}
          sx={{
            display: "grid",
            gridTemplateColumns: cols,
            columnGap: `${REPORT_PAD.xs}px`,
            alignItems: "center",
            py: `${REPORT_PAD.xs}px`,
            pl: `${REPORT_PAD.sm}px`,
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
              lineHeight: REPORT_LINE_HEIGHT.snug,
              fontWeight: row.tracked ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium,
              color: row.tracked ? color : palette.TEXT_COLOR,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fmtNum(row.strike)}
            <span style={{ fontSize: REPORT_FONT.micro, marginLeft: 3, color: palette.TEXT_MUTED }}>
              {wallCode(side === "CALL", wallSide(row.strike, spot), false)}
            </span>
          </Typography>
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
            sx={{
              fontSize: REPORT_FONT.sm,
              lineHeight: REPORT_LINE_HEIGHT.snug,
              textAlign: "right",
              color: erosionColor(row.erosion_5m),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtPct(row.erosion_5m)}
          </Typography>
          <Typography
            sx={{
              fontSize: REPORT_FONT.sm,
              lineHeight: REPORT_LINE_HEIGHT.snug,
              textAlign: "right",
              color: erosionColor(row.erosion_30m),
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
      ))}
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

export function NiftyWallsCardInner({
  walls,
  onExpand,
  emptyText = "No walls data.",
  levels,
}: {
  walls: WallsPayload | null;
  onExpand: () => void;
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
        <Box sx={{ p: `${REPORT_PAD.sm}px`, minHeight: 44, display: "flex", alignItems: "center" }}>
          <Typography sx={{ fontSize: REPORT_FONT.xs, color: palette.TEXT_MUTED }}>{emptyText}</Typography>
        </Box>
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
        <Button
          size="small"
          variant="outlined"
          onClick={onExpand}
          sx={{ py: 0, px: `${REPORT_PAD.sm}px`, minWidth: 0, fontSize: REPORT_FONT.micro }}
        >
          EXPAND
        </Button>
      }
      sx={{ borderTop: "none" }}
    >
      <Box
        sx={{
          display: "grid",
          // Widened wall tables: 250px | flex | flex | minmax(280px,1fr) | flex
          gridTemplateColumns: { xs: "minmax(0,1fr)", md: "250px 1fr 1fr minmax(280px,1fr) minmax(120px,1fr)" },
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
      {levels && (
        <Box
          sx={{
            borderTop: `1px solid ${palette.BORDER}`,
            pt: `${REPORT_PAD.sm}px`,
            minWidth: 0,
          }}
        >
          {levels}
        </Box>
      )}
    </CompactPanel>
  );
}

/** Memoised: the report panel re-renders on every ~1 s spot tick, and this
 *  card's inputs (`walls` object, stable callbacks) only change per poll. */
export const NiftyWallsCard = memo(NiftyWallsCardInner);
NiftyWallsCard.displayName = "NiftyWallsCard";